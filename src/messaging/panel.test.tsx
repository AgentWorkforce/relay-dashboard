import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getAccount, SignedOut } from "../api/client";
import { MessagingPanel } from "./panel";

vi.mock("../api/client", () => ({
  getAccount: vi.fn(),
  SignedOut: class SignedOut extends Error {},
}));

const people = {
  people: [
    {
      userId: "user-1",
      displayName: "Ada",
      email: "ada@example.test",
      handle: "@mada",
      name: "mada",
      photo: null,
    },
    {
      userId: "user-3",
      displayName: "Bob",
      email: "bob@example.test",
      handle: "@mbob",
      name: "mbob",
      photo: null,
    },
  ],
};

const thread = {
  you: "mowner",
  peer: "mada",
  messages: [
    { id: "m-in", text: "from ada", mine: false, sender: "mada" },
    { id: "m1", clientMessageId: "client-1", text: "hello", mine: true },
  ],
  earlier: null,
};

function signedIn() {
  vi.mocked(getAccount).mockResolvedValue({
    authenticated: true,
    user: { id: "user-2", name: "Owner" },
    currentWorkspace: { id: "ws-1", name: "Primary" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  vi.restoreAllMocks();
});

function stubLocation(hash = "#/messages") {
  const replace = vi.fn();
  const current = window.location;
  Reflect.deleteProperty(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: current.pathname,
      search: current.search,
      hash,
      replace,
    },
  });
  return replace;
}

it("redirects a signed-out visitor to the configured login path", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { loginPath: "/session/login" };
  const replace = stubLocation();
  vi.mocked(getAccount).mockRejectedValue(new SignedOut());
  render(<MessagingPanel />);
  await waitFor(() => expect(replace).toHaveBeenCalled());
  const target = String(replace.mock.calls[0]?.[0]);
  expect(target.startsWith("/session/login?next=")).toBe(true);
  expect(decodeURIComponent(target.split("next=")[1] ?? "")).toContain("#/messages");
  expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
});

it("lists a person, shows an inbound message, and sends once", async () => {
  signedIn();
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (String(path).endsWith("/identity/credential")) return Response.json({ identity: { name: "mowner" } });
    if (String(path).endsWith("/people")) return Response.json(people);
    if (init?.method === "POST") {
      return Response.json({
        you: "mowner",
        message: { id: "m2", clientMessageId: "ui-1", text: "again", mine: true },
      });
    }
    return Response.json(thread);
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", { randomUUID: () => "1" });
  render(<MessagingPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ada @mada" }));
  expect(await screen.findByText("hello")).toBeInTheDocument();
  expect(screen.getByText("from ada")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "again" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("again")).toBeInTheDocument();
  const posts = fetch.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(String(posts[0]?.[0])).toContain("/identity/credential");
  expect((posts[0]?.[1] as RequestInit).body).toBe("{}");
  expect(String(posts[1]?.[0])).toContain("/cloud/api/v1/workspaces/ws-1/messaging/conversations/mada");
});

it("sends a double click once and retries an uncertain send with the same id", async () => {
  signedIn();
  let sends = 0;
  let release: ((response: Response) => void) | undefined;
  const first = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (String(path).endsWith("/identity/credential")) return Response.json({ identity: { name: "mowner" } });
    if (String(path).endsWith("/people")) return Response.json(people);
    if (init?.method === "POST") {
      sends += 1;
      if (sends === 1) return first;
      const body = JSON.parse(String(init.body)) as { clientMessageId?: string; text?: string };
      if (sends === 2) {
        return Response.json({ error: "send_uncertain" }, { status: 502 });
      }
      return Response.json({
        you: "mowner",
        message: { id: "m9", clientMessageId: body.clientMessageId, text: body.text ?? "second", mine: true },
      });
    }
    return Response.json(thread);
  });
  vi.stubGlobal("fetch", fetch);
  let ids = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `0000000${++ids}` });
  render(<MessagingPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ada @mada" }));
  await screen.findByText("hello");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "again" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  release?.(Response.json({
    you: "mowner",
    message: { id: "m2", clientMessageId: "ui-00000001", text: "again", mine: true },
  }));
  expect(await screen.findByText("again")).toBeInTheDocument();
  const conversationPosts = () => fetch.mock.calls.filter((call) =>
    String(call[0]).includes("/conversations/") && (call[1] as RequestInit | undefined)?.method === "POST");
  expect(conversationPosts()).toHaveLength(1);

  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("will not send it twice");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("second")).toBeInTheDocument();
  const bodies = conversationPosts().map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { clientMessageId: string });
  expect(bodies[1]?.clientMessageId).toBe(bodies[2]?.clientMessageId);
  expect(bodies[1]?.clientMessageId).not.toBe(bodies[0]?.clientMessageId);
});

it("keeps a thread paired when reads resolve out of order and a send finishes late", async () => {
  signedIn();
  const reads = new Map<string, (response: Response) => void>();
  let sendRelease: ((response: Response) => void) | undefined;
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const target = String(path);
    if (target.endsWith("/identity/credential")) return Response.json({ identity: { name: "mowner" } });
    if (target.endsWith("/people")) return Response.json(people);
    if (init?.method === "POST") {
      return new Promise<Response>((resolve) => {
        sendRelease = resolve;
      });
    }
    const name = target.includes("/mbob") ? "mbob" : "mada";
    return new Promise<Response>((resolve) => {
      reads.set(name, resolve);
    });
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", { randomUUID: () => "0000000a" });
  render(<MessagingPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ada @mada" }));
  fireEvent.click(await screen.findByRole("button", { name: "Bob @mbob" }));
  reads.get("mbob")?.(Response.json({
    you: "mowner",
    peer: "mbob",
    messages: [{ id: "bob-1", text: "bob thread", mine: false, sender: "mbob" }],
    earlier: null,
  }));
  expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
  expect(await screen.findByText("bob thread")).toBeInTheDocument();
  reads.get("mada")?.(Response.json({
    you: "mowner",
    peer: "mada",
    messages: [{ id: "ada-1", text: "ada thread", mine: true }],
    earlier: null,
  }));
  await waitFor(() => expect(screen.queryByText("ada thread")).toBeNull());
  expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Ada @mada" }));
  reads.get("mada")?.(Response.json(thread));
  expect(await screen.findByText("hello")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "for ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.click(screen.getByRole("button", { name: "Bob @mbob" }));
  reads.get("mbob")?.(Response.json({
    you: null,
    peer: "mbob",
    messages: [],
    earlier: null,
  }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: "typed for bob" } });
  sendRelease?.(Response.json({
    you: "mowner",
    message: { id: "late", clientMessageId: "ui-0000000a", text: "for ada", mine: true },
  }));
  await waitFor(() => expect(screen.queryByText("for ada")).toBeNull());
  expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("typed for bob");
  expect(screen.queryByText("hello")).toBeNull();
});

it("does not keep the previous person's thread when a load fails, and follows a later 401", async () => {
  signedIn();
  let failBob = false;
  let unauthorized = false;
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (unauthorized) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (String(path).endsWith("/identity/credential")) return Response.json({ identity: { name: "mowner" } });
    if (String(path).endsWith("/people")) return Response.json(people);
    if (String(path).includes("/mbob") && failBob) return Response.json({ error: "upstream_unavailable" }, { status: 502 });
    if (init?.method === "POST") return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(thread);
  });
  vi.stubGlobal("fetch", fetch);
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { loginPath: "/session/login" };
  const replace = stubLocation();
  render(<MessagingPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ada @mada" }));
  expect(await screen.findByText("hello")).toBeInTheDocument();
  failBob = true;
  fireEvent.click(screen.getByRole("button", { name: "Bob @mbob" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t open that conversation.");
  expect(screen.queryByText("hello")).toBeNull();
  expect(screen.queryByText("from ada")).toBeNull();
  unauthorized = true;
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "later" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(String(replace.mock.calls[0]?.[0])).toContain("/session/login?next=");
});
