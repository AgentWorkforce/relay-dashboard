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

const providers = () => ({
  redirectUri: "https://api.example.com/api/v1/integrations/oauth/callback",
  canManage: role !== "member",
  providers: [
    {
      id: "github",
      displayName: "GitHub",
      description: "Repositories.",
      configKey: "github-relay",
      authMode: "OAUTH2",
      defaultScopes: ["repo", "read:org"],
      appSetupUrl: "https://github.com/settings/applications/new",
      configured: false,
      oauthApp: null,
      connection: null,
    },
    {
      id: "slack",
      displayName: "Slack",
      authMode: "OAUTH2",
      defaultScopes: ["chat:write"],
      configured: true,
      oauthApp: {
        clientId: "slack-client",
        clientSecretMasked: "sl****et",
        scopes: ["chat:write"],
        scopesOverridden: false,
        updatedAt: "2026-11-02T00:00:00.000Z",
      },
      connection: {
        connectionId: "c1",
        provider: "slack",
        status: "ready",
        authMode: "oauth2",
        scopes: ["chat:write"],
        accountLabel: "Acme Slack",
        lastError: null,
        connectedAt: "2026-11-02T00:00:00.000Z",
        accessTokenExpiresAt: null,
      },
    },
    {
      id: "posthog",
      displayName: "PostHog",
      authMode: "API_KEY",
      credentialFields: [
        {
          key: "apiKey",
          label: "Personal API key",
          secret: true,
          required: true,
        },
        { key: "host", label: "API host", secret: false, required: false },
      ],
      configured: true,
      oauthApp: null,
      connection: null,
    },
  ],
});

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
  if (path === "/cloud/api/v1/workspaces/w1/integrations/providers")
    return { body: providers() };
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
  expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
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

it("connections: shows callback URL, configures a BYO OAuth app, and connects in a popup", async () => {
  const popup = { location: { href: "" }, closed: false, close: vi.fn() };
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(popup as unknown as Window);
  extra = (call) => {
    if (
      call.path.endsWith("/integrations/github/oauth-app") &&
      call.method === "PUT"
    )
      return { body: {} };
    if (call.path.endsWith("/integrations/connect-session"))
      return {
        body: { connectLink: "https://slack.com/oauth/v2/authorize?state=s" },
      };
    return undefined;
  };
  render(<Settings section="connections" />);
  expect(
    await screen.findByText(
      "https://api.example.com/api/v1/integrations/oauth/callback",
    ),
  ).toBeInTheDocument();
  const github = screen.getByRole("article", { name: "GitHub" });
  expect(within(github).getByText("Disconnected")).toBeInTheDocument();
  expect(
    within(github).getByRole("button", { name: "Connect" }),
  ).toBeDisabled();
  fireEvent.click(
    within(github).getByRole("button", { name: "Configure OAuth app" }),
  );
  fireEvent.change(within(github).getByLabelText("Client ID"), {
    target: { value: "gh-id" },
  });
  fireEvent.change(within(github).getByLabelText("Client secret"), {
    target: { value: "gh-secret" },
  });
  fireEvent.click(
    within(github).getByRole("button", { name: "Save OAuth app" }),
  );
  await waitFor(() =>
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({
      clientId: "gh-id",
      clientSecret: "gh-secret",
      scopes: null,
    }),
  );

  const slack = screen.getByRole("article", { name: "Slack" });
  expect(within(slack).getByText("Connected")).toBeInTheDocument();
  expect(within(slack).getByText("Acme Slack")).toBeInTheDocument();
  fireEvent.click(within(slack).getByRole("button", { name: "Reconnect" }));
  await waitFor(() =>
    expect(popup.location.href).toBe(
      "https://slack.com/oauth/v2/authorize?state=s",
    ),
  );
  expect(open).toHaveBeenCalled();
  expect(
    calls.find((call) => call.path.endsWith("/connect-session"))!.body,
  ).toEqual({
    allowedIntegrations: ["slack"],
  });

  fireEvent.click(within(slack).getByRole("button", { name: "Disconnect" }));
  fireEvent.click(
    within(slack).getByRole("button", { name: "Confirm disconnect" }),
  );
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" && call.path.endsWith("/integrations/slack"),
      ),
    ).toBe(true),
  );
  open.mockRestore();
});

it("connections: API-key providers post only filled credential fields", async () => {
  extra = (call) =>
    call.method === "POST" && call.path.endsWith("/integrations/posthog")
      ? { status: 201, body: {} }
      : undefined;
  render(<Settings section="connections" />);
  const posthog = await screen.findByRole("article", { name: "PostHog" });
  fireEvent.click(within(posthog).getByRole("button", { name: "Connect" }));
  fireEvent.change(within(posthog).getByLabelText("Personal API key"), {
    target: { value: "phx_1" },
  });
  fireEvent.click(within(posthog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      calls.find((call) => call.path.endsWith("/integrations/posthog"))!.body,
    ).toEqual({
      credentials: { apiKey: "phx_1" },
    }),
  );
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
  render(<Settings section="members" />);
  const bea = (await screen.findByText("Bea")).closest("tr")!;
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
  const me = screen.getByText(/\(you\)/).closest("tr")!;
  expect(
    within(me).queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(bea).getByRole("button", { name: "Remove" }));
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
    await screen.findByRole("heading", { name: "Environment" }),
  ).toBeInTheDocument();
});
