import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FlowIntegrations, requiredIntegrationIds } from "./flow-integrations";

const SOURCE = `import { flow } from "@relayflows/sdk";
export default flow("triage", { tools: { github: true, slack: true, linear: true } }, async (f) => {});
`;

let calls: Array<{ method: string; path: string; body: unknown }> = [];
let githubReady = false;
beforeEach(() => {
  calls = [];
  githubReady = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path === "/cloud/api/v1/auth/whoami")
        return json({
          user: { id: "u1", email: "me@acme.test", name: "Me" },
          currentOrganization: { id: "o1", name: "Acme", role: "member" },
          currentWorkspace: { id: "w1", name: "Primary" },
        });
      if (path === "/cloud/api/v1/workspaces/w1/integrations/providers")
        return json({
          providers: [
            { id: "github", displayName: "GitHub", authMode: "OAUTH2", configured: true, connection: githubReady ? { status: "ready" } : null },
            { id: "slack", displayName: "Slack", authMode: "OAUTH2", configured: false, adminMessage: "Your administrator needs to configure the Slack app before it can be connected.", connection: null },
            { id: "linear", displayName: "Linear", authMode: "OAUTH2", configured: true, connection: { status: "ready" } },
          ],
        });
      if (path === "/cloud/api/v1/workspaces/w1/integrations/connect-session" && method === "POST")
        return json({ connectLink: "https://github.com/login/oauth/authorize?client_id=x&state=s" });
      return json({ error: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reads the integrations a flow declares", () => {
  expect(requiredIntegrationIds(SOURCE)).toEqual(["github", "slack", "linear"]);
  expect(requiredIntegrationIds("version: '1.0'\nworkflows: []\n")).toEqual([]);
  // A helper used only in the body still needs its integration.
  const bodyOnly = `export default flow("notify", {}, async (f) => {\n  await f.slack.post({ channel: "#eng", text: "hi" });\n});\n`;
  expect(requiredIntegrationIds(bodyOnly)).toContain("slack");
});

it("connects a missing integration just in time and shows the admin message for an unconfigured app", async () => {
  const popup = { location: { href: "" }, closed: false, close: vi.fn(), opener: {} };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  render(<FlowIntegrations source={SOURCE} />);
  const slack = await screen.findByTestId("flow-integration-slack");
  expect(within(slack).getByText("Your administrator needs to configure the Slack app before it can be connected.")).toBeInTheDocument();
  expect(within(slack).queryByRole("button")).not.toBeInTheDocument();
  expect(within(screen.getByTestId("flow-integration-linear")).getByText("Connected")).toBeInTheDocument();
  const github = screen.getByTestId("flow-integration-github");
  fireEvent.click(within(github).getByRole("button", { name: "Connect GitHub" }));
  await waitFor(() => expect(popup.location.href).toContain("https://github.com/login/oauth/authorize"));
  const connect = calls.find((call) => call.path.endsWith("/integrations/connect-session"))!;
  expect(connect.body).toEqual({ allowedIntegrations: ["github"], returnTo: window.location.href });
  expect(popup.opener).toBeNull();
  githubReady = true;
  popup.closed = true;
  await waitFor(() => expect(within(github).getByText("Connected")).toBeInTheDocument(), { timeout: 5000 });
});

it("renders nothing for a flow that declares no integrations", () => {
  const { container } = render(<FlowIntegrations source={"version: '1.0'\n"} />);
  expect(container).toBeEmptyDOMElement();
});

it("reads helpers only from the flow body and .on handlers, not data callbacks", () => {
  const data = `import { flow } from "@relayflows/sdk";
export default flow("data", async (f) => {
  const items = [{ github: 1 }];
  items.map((item) => item.github);
  [1].forEach(function (row) { return row.slack; });
});
`;
  expect(requiredIntegrationIds(data)).toEqual([]);
  const handler = `import { flow } from "@relayflows/sdk";
export default flow("events", async (f) => { await f.linear.comment("x"); })
  .on("pr.opened", async (ctx) => { await ctx.slack.post("#a", "hi"); });
`;
  expect(requiredIntegrationIds(handler).sort()).toEqual(["linear", "slack"]);
});

it("resolves callbacks passed by name to flow and .on", () => {
  const named = `import { flow } from "@relayflows/sdk";
async function notify(ctx) { await ctx.slack.post("#a", "hi"); }
const onPr = async (event) => { await event.github.comment("x"); };
export default flow("notify", notify).on("pr.opened", onPr);
`;
  expect(requiredIntegrationIds(named).sort()).toEqual(["github", "slack"]);
});

it("ignores other emitters, decoy flow calls and async-prefixed names", () => {
  const source = `import { flow as defineFlow } from "@relayflows/surface";
const emitter = { on() {} };
function listener(tick) { return tick.linear; }
emitter.on("tick", listener);
function decoy(d) { return d.jira; }
const helper = defineFlow("helper", decoy);
const main = asyncCtx => asyncCtx.github.comment("x");
export default defineFlow("main", main).on("evt", async (e) => { await e.slack.post("#a", "b"); });
`;
  expect(requiredIntegrationIds(source).sort()).toEqual(["github", "slack"]);
});

it("reads .on handlers registered on the variable bound to the flow", () => {
  const source = `import { flow } from "@relayflows/sdk";
const w = flow("events", async (f) => {});
w.on("pr.opened", async (ctx) => { await ctx.github.comment("x"); });
export default w;
`;
  expect(requiredIntegrationIds(source)).toEqual(["github"]);
});
