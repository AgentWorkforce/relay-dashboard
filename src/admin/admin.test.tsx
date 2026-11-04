import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { adminApi, ApiError } from "./api";
import { Settings } from "./settings";
import { App } from "../app";

type Call = { method: string; path: string; body: unknown; init: RequestInit };
type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

let calls: Call[] = [];
let role: "owner" | "admin" | "member" = "owner";
let envRows: Array<Record<string, unknown>> = [];
let extra: Handler | null = null;



function respond(call: Call): { status?: number; body?: unknown } {
  const custom = extra?.(call);
  if (custom) return custom;
  const { method, path } = call;
  if (path === "/cloud/api/v1/auth/whoami")
    return {
      body: {
        user: { id: "u1", email: "me@acme.test", name: "Me" },
        currentOrganization: { id: "o1", name: "Acme", role },
        currentWorkspace: { id: "w1", name: "Primary" },
      },
    };
  if (path === "/cloud/api/v1/workspaces/w1/secrets" && method === "GET")
    return { body: { ok: true, data: { items: envRows } } };
  if (path === "/cloud/api/v1/workspaces/w1/secrets" && method === "POST") {
    const body = call.body as { name: string };
    envRows = [
      ...envRows.filter((row) => row.name !== body.name),
      row(body.name, "ne****ue"),
    ];
    return { status: 201, body: row(body.name, "ne****ue") };
  }
  if (
    path.startsWith("/cloud/api/v1/workspaces/w1/secrets/") &&
    method === "DELETE"
  ) {
    const name = decodeURIComponent(path.split("/").pop()!);
    const found = envRows.find((item) => item.name === name);
    envRows = envRows.filter((item) => item.name !== name);
    return { body: found };
  }
  if (
    path === "/cloud/api/v1/workspaces/w1/deployment-api-tokens" &&
    method === "GET"
  )
    return { body: { tokens: [] } };
  if (path === "/cloud/api/v1/organizations/o1/memberships" && method === "GET")
    return {
      body: {
        memberships: [
          { userId: "u1", email: "me@acme.test", name: "Me", role },
          { userId: "u2", email: "b@acme.test", name: "Bea", role: "member" },
        ],
      },
    };
  if (path === "/cloud/api/v1/organizations/o1/workspaces")
    return { body: { workspaces: [{ id: "w1", name: "Primary" }] } };
  return {
    status: 404,
    body: { error: "not_found", message: `No fake for ${method} ${path}` },
  };
}

function row(name: string, maskedValue: string, delivered = true) {
  return {
    name,
    envVar: name,
    kind: "environment",
    maskedValue,
    deliveredToFlowRuns: delivered,
    setBy: "u1",
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
}

beforeEach(() => {
  calls = [];
  role = "owner";
  extra = null;
  envRows = [
    row("ANTHROPIC_API_KEY", "sk*************ue"),
    row("RELAY_X", "****", false),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: input,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        init,
      };
      calls.push(call);
      const { status = 200, body } = respond(call);
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
      });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("sends same-origin JSON writes and surfaces API error messages", async () => {
  extra = (call) =>
    call.method === "POST"
      ? {
          status: 400,
          body: {
            error: "invalid_workspace_secret",
            message: "PATH is reserved",
          },
        }
      : undefined;
  const failure = await adminApi
    .putEnv("w/1", "PATH", "x")
    .catch((error) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.message).toBe("PATH is reserved");
  const call = calls[0]!;
  expect(call.path).toBe("/cloud/api/v1/workspaces/w%2F1/secrets");
  expect(call.init.credentials).toBe("same-origin");
  expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe(
    "application/json",
  );
  expect(call.body).toEqual({
    name: "PATH",
    envVar: "PATH",
    value: "x",
    kind: "environment",
  });
});

it("environment: masked values only, add/replace and two-step delete for admins", async () => {
  render(<Settings section="environment" />);
  const table = await screen.findByRole("table");
  expect(within(table).getByText("sk*************ue")).toBeInTheDocument();
  expect(
    within(table).getByText(/Reserved name: not delivered/),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "ANTHROPIC_API_KEY" },
  });
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "replacement-value" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(
    await screen.findByText("Replaced ANTHROPIC_API_KEY."),
  ).toBeInTheDocument();
  expect(
    calls.filter((call) => call.method === "POST").at(-1)!.body,
  ).toMatchObject({ name: "ANTHROPIC_API_KEY", value: "replacement-value" });
  expect(document.body.textContent).not.toContain("replacement-value");
  expect(screen.getByLabelText("Value")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "NEW_KEY" },
  });
  expect(screen.getByLabelText("Value")).toHaveAttribute("type", "password");
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "new-secret-value" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Added NEW_KEY.")).toBeInTheDocument();
  expect(await screen.findByText("NEW_KEY")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("new-secret-value");

  const anthropic = within(screen.getByRole("table"))
    .getByText("ANTHROPIC_API_KEY")
    .closest("tr")!;
  fireEvent.click(within(anthropic).getByRole("button", { name: "Delete" }));
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  fireEvent.click(
    within(anthropic).getByRole("button", { name: "Confirm delete" }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("table")).queryByText("ANTHROPIC_API_KEY"),
    ).not.toBeInTheDocument(),
  );
  expect(calls.find((call) => call.method === "DELETE")!.path).toBe(
    "/cloud/api/v1/workspaces/w1/secrets/ANTHROPIC_API_KEY",
  );
});

it("members see read-only settings and no API tokens section", async () => {
  role = "member";
  render(<Settings section="environment" />);
  expect(
    await screen.findByText(/Only organization owners and admins can change/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete" }),
  ).not.toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Settings" });
  expect(within(nav).queryByText("API tokens")).not.toBeInTheDocument();
  expect(within(nav).getByText("Connections")).toBeInTheDocument();
});

it("settings has no Integrations section: integrations connect just in time", async () => {
  render(<Settings section="integrations" />);
  const nav = await screen.findByRole("navigation", { name: "Settings" });
  expect(within(nav).queryByText("Integrations")).not.toBeInTheDocument();
  // An old #/settings/integrations link falls back to the default section.
  expect(await screen.findByRole("heading", { level: 1, name: "Workspace" })).toBeInTheDocument();
});

it("API tokens: shows the new token once with a copy panel", async () => {
  extra = (call) =>
    call.method === "POST" && call.path.endsWith("/deployment-api-tokens")
      ? {
          status: 201,
          body: {
            id: "t1",
            label: "flows-worker",
            purpose: "agent-runtime",
            scopes: ["runtime:env:read"],
            createdBy: { id: "u1", name: "Me", email: null },
            createdAt: "2026-11-02T00:00:00.000Z",
            accessTokenExpiresAt: "2027-01-31T00:00:00.000Z",
            lastUsedAt: null,
            status: "active",
            accessToken: "sh_wk_secret_once",
          },
        }
      : undefined;
  render(<Settings section="tokens" />);
  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "flows-worker" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  expect(await screen.findByText(/Copy this token now/)).toBeInTheDocument();
  expect(screen.getByText("sh_wk_secret_once")).toBeInTheDocument();
  expect(calls.find((call) => call.method === "POST")!.body).toEqual({
    label: "flows-worker",
    purpose: "agent-runtime",
    expiryDays: 90,
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("sh_wk_secret_once")).not.toBeInTheDocument();
});

it("members section lets admins change roles and remove others", async () => {
  extra = (call) =>
    (call.method === "POST" || call.method === "DELETE") &&
    call.path.includes("/memberships")
      ? { body: {} }
      : undefined;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Settings section="members" />);
  const bea = (await screen.findByText("Bea")).closest("tr")!;
  const whoami = () =>
    calls.filter((call) => call.path === "/cloud/api/v1/auth/whoami").length;
  const contextLoads = whoami();
  fireEvent.change(within(bea).getByLabelText("Role for b@acme.test"), {
    target: { value: "admin" },
  });
  await waitFor(() =>
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({
      email: "b@acme.test",
      name: "Bea",
      role: "admin",
    }),
  );
  // A role change can change the viewer's own permissions: refresh context.
  await waitFor(() => expect(whoami()).toBeGreaterThan(contextLoads));
  const me = screen.getByText(/\(you\)/).closest("tr")!;
  expect(
    within(me).queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(bea).getByRole("button", { name: "Remove" }));
  expect(confirm).toHaveBeenCalled();
  await waitFor(() =>
    expect(calls.find((call) => call.method === "DELETE")!.path).toBe(
      "/cloud/api/v1/organizations/o1/memberships/u2",
    ),
  );
});

it("hash routes switch between sessions and settings", async () => {
  window.location.hash = "#/settings/environment";
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Settings" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Environment", level: 1 }),
  ).toBeInTheDocument();
});

it("organization rename sends the trimmed name and reports the result", async () => {
  extra = (call) =>
    call.method === "PATCH" && call.path === "/cloud/api/v1/organizations/o1"
      ? { body: { id: "o1", name: "Acme Labs" } }
      : undefined;
  render(<Settings section="organization" />);
  const input = await screen.findByLabelText("Name");
  fireEvent.change(input, { target: { value: "  Acme Labs  " } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === "PATCH")!.body).toEqual({
      name: "Acme Labs",
    }),
  );
  expect(await screen.findByText("Organization renamed.")).toBeInTheDocument();
});

it("organization rename shows the server's error", async () => {
  extra = (call) =>
    call.method === "PATCH"
      ? { status: 409, body: { error: "conflict", message: "Name taken." } }
      : undefined;
  render(<Settings section="organization" />);
  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "Other" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(await screen.findByText("Name taken.")).toBeInTheDocument();
});

it("API tokens: leaving the workflow purpose resets a Never expiry", async () => {
  render(<Settings section="tokens" />);
  const purpose = await screen.findByLabelText("Purpose");
  fireEvent.change(purpose, { target: { value: "workflow" } });
  const expires = screen.getByLabelText("Expires") as HTMLSelectElement;
  fireEvent.change(expires, { target: { value: "never" } });
  expect(expires.value).toBe("never");
  fireEvent.change(purpose, { target: { value: "agent-runtime" } });
  expect(expires.value).toBe("90");
});
