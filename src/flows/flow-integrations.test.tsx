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
