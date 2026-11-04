import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "./settings";

type Call = { method: string; path: string; body: unknown };

let calls: Call[] = [];
let role: "owner" | "admin" | "member" = "owner";
let agents: Array<Record<string, unknown>> = [];

const PROVIDERS = [
  { id: "anthropic", displayName: "Anthropic", harness: "claude", envName: "ANTHROPIC_API_KEY", authTypes: ["oauth_token", "byo_api_key"], keyPlaceholder: "sk-ant-api03-…", docsUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", displayName: "OpenAI", harness: "codex", envName: "OPENAI_API_KEY", authTypes: ["byo_api_key"] },
  { id: "openrouter", displayName: "OpenRouter", harness: "openrouter", envName: "OPENROUTER_API_KEY", authTypes: ["byo_api_key"] },
  { id: "xai", displayName: "xAI", harness: "grok", envName: "XAI_API_KEY", authTypes: ["byo_api_key"] },
  { id: "google", displayName: "Google", harness: "gemini", envName: "GEMINI_API_KEY", authTypes: ["byo_api_key"] },
];

function agent(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    displayName: "Anthropic API key",
    harness: "claude",
    modelProvider: "anthropic",
    authType: "byo_api_key",
    label: null,
    accountEmail: null,
    secretPreview: "sk-ant-…0001",
    isActive: true,
    harnessActive: false,
    defaultModel: null,
    status: "connected",
    lastAuthenticatedAt: "2026-11-03T00:00:00.000Z",
    lastCheckedAt: null,
    lastUsedAt: null,
    lastError: null,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    owner: { userId: "u1", name: "Me", email: "me@acme.test", avatarUrl: null },
    ...overrides,
  };
}

function respond(call: Call): { status?: number; body?: unknown } {
  const { method, path } = call;
  if (path === "/cloud/api/v1/auth/whoami")
    return {
      body: {
        user: { id: "u1", email: "me@acme.test", name: "Me" },
        currentOrganization: { id: "o1", name: "Acme", role },
        currentWorkspace: { id: "w1", name: "Primary" },
      },
    };
  if (path === "/cloud/api/v1/workspaces/w1/cloud-agents" && method === "GET")
    return { body: { agents, providers: PROVIDERS, canManage: role !== "member" } };
  if (path === "/cloud/api/v1/workspaces/w1/provider-credentials/byok" && method === "POST") {
    const body = call.body as { modelProvider: string; label?: string };
    const created = agent({
      id: "a2",
      modelProvider: body.modelProvider,
      displayName: body.label ?? "OpenRouter API key",
      label: body.label ?? null,
      harness: body.modelProvider,
      secretPreview: "sk-or-v…0003",
    });
    agents = [created, ...agents];
    return { status: 201, body: { id: "a2", providerCredentialId: "a2", agent: created } };
  }
  if (path === "/cloud/api/v1/workspaces/w1/provider-credentials/setup-token" && method === "POST") {
    const created = agent({
      id: "a3",
      authType: "oauth_token",
      displayName: "Claude setup token",
      accountEmail: (call.body as { accountEmail?: string }).accountEmail ?? null,
      isActive: false,
      harnessActive: true,
      secretPreview: "sk-ant-…0002",
    });
    agents = [created, ...agents];
    return { status: 201, body: { id: "a3", providerCredentialId: "a3", agent: created } };
  }
  const activate = /\/cloud-agents\/([^/]+)\/activate$/.exec(path);
  if (activate && method === "POST") {
    const target = agents.find((item) => item.id === activate[1])!;
    const selection = (call.body as { selection: string }).selection;
    const column = selection === "model" ? "isActive" : "harnessActive";
    agents = agents.map((item) =>
      item.modelProvider === target.modelProvider ? { ...item, [column]: item.id === target.id } : item,
    );
    return { body: { agent: target } };
  }
  if (/\/cloud-agents\/[^/]+\/check$/.test(path) && method === "POST")
    return { body: { status: "available", checkedAt: "2026-11-03T00:00:00.000Z", message: "Anthropic API key authenticated with the provider." } };
  const item = /\/cloud-agents\/([^/]+)$/.exec(path);
  if (item && method === "DELETE") {
    agents = agents.filter((entry) => entry.id !== item[1]);
    return { body: { deleted: true, id: item[1] } };
  }
  return { status: 404, body: { error: "not_found", message: `No fake for ${method} ${path}` } };
}

beforeEach(() => {
  calls = [];
  role = "owner";
  agents = [agent({})];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: input,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const { status = 200, body } = respond(call);
      return new Response(JSON.stringify(body), { status });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("connections shows hosted's Coding agents summary and provider rows", async () => {
  render(<Settings section="connections" />);
  expect(await screen.findByRole("heading", { name: "Coding agents" })).toBeInTheDocument();
  expect(screen.getByText("Connect coding agents to Primary.")).toBeInTheDocument();
  const summary = await screen.findByTestId("harness-credentials-summary");
  expect(summary).toHaveTextContent("1 credential connected across the workspace");
  expect(summary).toHaveTextContent("Anthropic");

  const anthropic = screen.getByTestId("provider-group-anthropic");
  expect(within(anthropic).getByText("Connected")).toBeInTheDocument();
  expect(within(anthropic).getByText("1 credential")).toBeInTheDocument();
  expect(within(anthropic).getByText("Not supported")).toBeInTheDocument();
  expect(within(anthropic).getByTitle("Me")).toBeInTheDocument();
  const openai = screen.getByTestId("provider-group-openai");
  expect(within(openai).getByText("Not connected")).toBeInTheDocument();
  expect(within(openai).getByText("Not supported")).toBeInTheDocument();

  // Integrations (BYO OAuth) moved to their own section.
  const nav = screen.getByRole("navigation", { name: "Settings" });
  expect(within(nav).getByText("Integrations")).toBeInTheDocument();
  expect(screen.queryByText(/OAuth callback/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("provider-group-anthropic-toggle"));
  const row = await screen.findByTestId("harness-credential-a1");
  expect(within(row).getByTestId("harness-preview-a1")).toHaveTextContent("sk-ant-…0001");
  expect(within(row).getByText("Model calls only · not a sandbox login")).toBeInTheDocument();
  expect(within(row).getByText("Active")).toBeInTheDocument();

  fireEvent.click(within(row).getByRole("button", { name: /Check token/ }));
  expect(await within(row).findByText("Anthropic API key authenticated with the provider.")).toBeInTheDocument();
  expect(calls.some((call) => call.path.endsWith("/cloud-agents/a1/check") && call.method === "POST")).toBe(true);
});

it("connects an API key and a Claude setup token, then assigns and removes them", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Settings section="connections" />);
  fireEvent.click(await screen.findByRole("button", { name: /Connect agent/ }));
  const dialog = screen.getByRole("dialog", { name: "Connect an agent" });
  expect(within(dialog).queryByRole("button", { name: /Daytona/ })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /OpenRouter/ }));
  fireEvent.change(within(dialog).getByLabelText("API key"), { target: { value: "sk-or-v1-secret-0003" } });
  fireEvent.change(within(dialog).getByLabelText(/Label/), { target: { value: "Router" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Connect OpenRouter" }));
  expect(await within(dialog).findByText("OpenRouter connected")).toBeInTheDocument();
  const posted = calls.find((call) => call.path.endsWith("/provider-credentials/byok"))!;
  expect(posted.body).toEqual({ modelProvider: "openrouter", key: "sk-or-v1-secret-0003", label: "Router" });
  expect(within(dialog).queryByDisplayValue("sk-or-v1-secret-0003")).not.toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: /All agents/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: /^Claude$/ }));
  expect(within(dialog).getByText("claude setup-token")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Setup token"), { target: { value: "sk-ant-oat01-0002" } });
  fireEvent.change(within(dialog).getByLabelText(/Account email/), { target: { value: "dev@acme.test" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Connect Claude" }));
  expect(await within(dialog).findByText("Claude connected")).toBeInTheDocument();
  const setupPost = calls.find((call) => call.path.endsWith("/provider-credentials/setup-token"))!;
  expect(setupPost.body).toEqual({ token: "sk-ant-oat01-0002", accountEmail: "dev@acme.test" });
  fireEvent.click(within(dialog).getByRole("button", { name: /Back to connections/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  const summary = await screen.findByTestId("harness-credentials-summary");
  await waitFor(() => expect(summary).toHaveTextContent("3 credentials connected"));
  const anthropic = screen.getByTestId("provider-group-anthropic");
  expect(within(anthropic).getByText("dev@acme.test")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("provider-group-anthropic-toggle"));
  const tokenRow = await screen.findByTestId("harness-credential-a3");
  fireEvent.click(within(tokenRow).getByRole("button", { name: "Use for LLM calls" }));
  await waitFor(() =>
    expect(calls.some((call) => call.path.endsWith("/cloud-agents/a3/activate") && (call.body as { selection: string }).selection === "model")).toBe(true),
  );
  await waitFor(() => expect(within(screen.getByTestId("harness-credential-a1")).getByRole("button", { name: "Use for LLM calls" })).toBeInTheDocument());

  fireEvent.click(within(screen.getByTestId("harness-credential-a3")).getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(screen.queryByTestId("harness-credential-a3")).not.toBeInTheDocument());
  expect(calls.some((call) => call.path.endsWith("/cloud-agents/a3") && call.method === "DELETE")).toBe(true);
});

it("members see coding agents read-only", async () => {
  role = "member";
  render(<Settings section="connections" />);
  expect(await screen.findByTestId("harness-credentials-summary")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Connect agent/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("provider-group-anthropic-toggle"));
  const row = await screen.findByTestId("harness-credential-a1");
  expect(within(row).queryByRole("button", { name: /Check token/ })).not.toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
});

it("honors an explicit unselected sandbox token and keeps Tab inside the dialog", async () => {
  agents = [agent({ id: "a4", authType: "oauth_token", displayName: "Claude setup token", isActive: false, harnessActive: false })];
  render(<Settings section="connections" />);
  const anthropic = await screen.findByTestId("provider-group-anthropic");
  expect(within(anthropic).getAllByText("None selected").length).toBe(2);
  fireEvent.click(screen.getByTestId("provider-group-anthropic-toggle"));
  const row = await screen.findByTestId("harness-credential-a4");
  fireEvent.click(within(row).getByRole("button", { name: "Use for sandbox" }));
  await waitFor(() =>
    expect(calls.some((call) => call.path.endsWith("/cloud-agents/a4/activate") && (call.body as { selection: string }).selection === "harness")).toBe(true),
  );

  fireEvent.click(screen.getByRole("button", { name: /Connect agent/ }));
  const dialog = screen.getByRole("dialog", { name: "Connect an agent" });
  const buttons = within(dialog).getAllByRole("button");
  buttons[buttons.length - 1]!.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
});

it("a list refresh does not move focus out of the connect dialog", async () => {
  render(<Settings section="connections" />);
  fireEvent.click(await screen.findByRole("button", { name: /Connect agent/ }));
  const dialog = screen.getByRole("dialog", { name: "Connect an agent" });
  fireEvent.click(within(dialog).getByRole("button", { name: /OpenRouter/ }));
  const input = within(dialog).getByLabelText("API key");
  input.focus();
  fireEvent.click(screen.getByTestId("provider-group-anthropic-toggle"));
  await screen.findByTestId("harness-credential-a1");
  expect(document.activeElement).toBe(input);
});

it("each row stays busy until its own check finishes", async () => {
  agents = [agent({}), agent({ id: "a5", modelProvider: "anthropic", label: "Second", secretPreview: "sk-ant-…0005", isActive: false })];
  const pending: Array<() => void> = [];
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    if (input.endsWith("/check")) {
      calls.push({ method: "POST", path: input, body: {} });
      await new Promise<void>((resolve) => pending.push(resolve));
      return new Response(JSON.stringify({ status: "available", checkedAt: "2026-11-03T00:00:00.000Z", message: `checked ${input}` }), { status: 200 });
    }
    return original(input, init);
  }));
  render(<Settings section="connections" />);
  fireEvent.click(await screen.findByTestId("provider-group-anthropic-toggle"));
  const first = await screen.findByTestId("harness-credential-a1");
  const second = screen.getByTestId("harness-credential-a5");
  fireEvent.click(within(first).getByRole("button", { name: /Check token/ }));
  fireEvent.click(within(second).getByRole("button", { name: /Check token/ }));
  await waitFor(() => expect(pending.length).toBe(2));
  pending[0]!();
  await within(first).findByText(/checked .*a1\/check/);
  expect(within(second).getByRole("button", { name: /Checking/ })).toBeDisabled();
  pending[1]!();
  await within(second).findByText(/checked .*a5\/check/);
});

