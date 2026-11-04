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
  render(<Settings section="integrations" />);
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
});

it("connections: API-key providers post only filled credential fields", async () => {
  extra = (call) =>
    call.method === "POST" && call.path.endsWith("/integrations/posthog")
      ? { status: 201, body: {} }
      : undefined;
  render(<Settings section="integrations" />);
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
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Settings section="members" />);
  expect(await screen.findByText("Organization access")).toBeInTheDocument();
  const bea = await screen.findByTestId("member-b@acme.test");
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
  const me = screen.getByTestId("member-me@acme.test");
  expect(within(me).getByText(/\(you\)/)).toBeInTheDocument();
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

function inviteFakes(options: { inviteEmail: boolean; delivery: string }) {
  let invites: Array<Record<string, unknown>> = [
    {
      id: "i1",
      email: "old@acme.test",
      role: "member",
      status: "pending",
      invitedBy: { id: "u1", name: "Me", email: "me@acme.test" },
      createdAt: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-11-08T00:00:00.000Z",
    },
  ];
  extra = (call) => {
    if (call.path === "/cloud/api/v1/auth/methods")
      return {
        body: {
          oidc: { displayName: "Acme SSO", allowedDomains: ["acme.test"] },
          emailLink: false,
          inviteEmail: options.inviteEmail,
          autoJoinDomains: [],
          inviteTtlHours: 168,
        },
      };
    if (call.path === "/cloud/api/v1/organizations/o1/invitations" && call.method === "GET")
      return { body: { invitations: invites } };
    if (call.path === "/cloud/api/v1/organizations/o1/invitations" && call.method === "POST") {
      const body = call.body as { email: string; role: string };
      const invitation = {
        id: "i2",
        email: body.email,
        role: body.role,
        status: "pending",
        invitedBy: { id: "u1", name: "Me", email: "me@acme.test" },
        createdAt: "2026-11-03T00:00:00.000Z",
        expiresAt: "2026-11-10T00:00:00.000Z",
      };
      invites = [invitation, ...invites];
      return {
        status: 201,
        body: {
          invitation,
          inviteUrl: "https://relay.acme.test/login?invite=sh_inv_new_link_aaaaaaaaaaaaaaaa",
          emailDelivery: options.delivery,
        },
      };
    }
    if (call.path === "/cloud/api/v1/organizations/o1/invitations/i1/link" && call.method === "POST")
      return {
        body: {
          invitation: invites.find((i) => i.id === "i1"),
          inviteUrl: "https://relay.acme.test/login?invite=sh_inv_rotated_bbbbbbbbbbbbbbbb",
          emailDelivery: (call.body as { send?: boolean }).send ? "sent" : "skipped",
        },
      };
    if (call.path === "/cloud/api/v1/organizations/o1/invitations/i1" && call.method === "DELETE") {
      invites = invites.filter((i) => i.id !== "i1");
      return { body: { revoked: true } };
    }
    return undefined;
  };
}

it("owners invite by email; a link to copy is shown when email is not configured", async () => {
  inviteFakes({ inviteEmail: false, delivery: "not_configured" });
  render(<Settings section="members" />);
  const pending = await screen.findByTestId("invite-old@acme.test");
  expect(within(pending).getByText(/member • invited by Me • expires/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/copy the link and send it yourself/)).toBeInTheDocument();
  expect(within(dialog).getByText(/sign in with Acme SSO/)).toBeInTheDocument();
  // Owners may invite every role.
  expect(
    within(dialog).getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Member", "Admin", "Owner"]);
  fireEvent.change(within(dialog).getByPlaceholderText("colleague@example.com"), {
    target: { value: " new@acme.test " },
  });
  fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "admin" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
  await waitFor(() =>
    expect(
      calls.find((call) => call.method === "POST" && call.path.endsWith("/invitations"))!.body,
    ).toEqual({ email: "new@acme.test", role: "admin" }),
  );
  expect(
    await screen.findByText(/Email delivery is not configured for this installation/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("https://relay.acme.test/login?invite=sh_inv_new_link_aaaaaaaaaaaaaaaa"),
  ).toBeInTheDocument();
  expect(await screen.findByTestId("invite-new@acme.test")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("the invite dialog keeps focus inside, closes on Escape and returns focus", async () => {
  inviteFakes({ inviteEmail: true, delivery: "sent" });
  render(<Settings section="members" />);
  const opener = await screen.findByRole("button", { name: "Invite member" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  const email = within(dialog).getByPlaceholderText("colleague@example.com");
  expect(document.activeElement).toBe(email);
  const close = within(dialog).getByRole("button", { name: "Close" });
  close.focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(document.activeElement).toBe(opener);
});

it("pending invites: copy link issues a fresh link, resend emails it, cancel revokes", async () => {
  inviteFakes({ inviteEmail: true, delivery: "sent" });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<Settings section="members" />);
  const pending = await screen.findByTestId("invite-old@acme.test");
  fireEvent.click(within(pending).getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      "https://relay.acme.test/login?invite=sh_inv_rotated_bbbbbbbbbbbbbbbb",
    ),
  );
  expect(await screen.findByText(/Earlier links for this invite no longer work/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId("invite-old@acme.test")).getByRole("button", { name: "Resend" }));
  await waitFor(() =>
    expect(
      calls.filter((call) => call.path.endsWith("/i1/link")).map((call) => call.body),
    ).toEqual([{ send: false }, { send: true }]),
  );
  expect(await screen.findByText("Invitation emailed to old@acme.test.")).toBeInTheDocument();
  // An emailed link is not displayed unless asked for.
  expect(screen.queryByText(/sh_inv_rotated/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show link" }));
  expect(screen.getByText(/sh_inv_rotated/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText(/sh_inv_rotated/)).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId("invite-old@acme.test")).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByTestId("invite-old@acme.test")).not.toBeInTheDocument(),
  );
  expect(await screen.findByText("No pending invitations.")).toBeInTheDocument();
});

it("admins cannot invite or manage owners; members cannot invite", async () => {
  role = "admin";
  inviteFakes({ inviteEmail: true, delivery: "sent" });
  const base = extra!;
  extra = (call) =>
    call.path === "/cloud/api/v1/organizations/o1/memberships" && call.method === "GET"
      ? {
          body: {
            memberships: [
              { userId: "u1", email: "me@acme.test", name: "Me", role: "admin" },
              { userId: "u0", email: "boss@acme.test", name: "Boss", role: "owner" },
            ],
          },
        }
      : base(call);
  const { unmount } = render(<Settings section="members" />);
  const boss = await screen.findByTestId("member-boss@acme.test");
  expect(within(boss).queryByLabelText("Role for boss@acme.test")).not.toBeInTheDocument();
  expect(within(boss).getByText("Owner")).toBeInTheDocument();
  expect(within(boss).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Member", "Admin"]);
  unmount();

  role = "member";
  render(<Settings section="members" />);
  expect(await screen.findByText(/can send invites — ask one to invite your teammates/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
});

it("invite errors from the API are shown in the dialog", async () => {
  inviteFakes({ inviteEmail: true, delivery: "sent" });
  const base = extra!;
  extra = (call) =>
    call.path === "/cloud/api/v1/organizations/o1/invitations" && call.method === "POST"
      ? { status: 409, body: { error: "already_member", message: "That person is already a member of this organization." } }
      : base(call);
  render(<Settings section="members" />);
  fireEvent.click(await screen.findByRole("button", { name: "Invite member" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByPlaceholderText("colleague@example.com"), {
    target: { value: "b@acme.test" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
  expect(
    await within(dialog).findByText("That person is already a member of this organization."),
  ).toBeInTheDocument();
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
