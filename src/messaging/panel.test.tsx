import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getAccount, SignedOut } from "../api/client";
import { MessagingPanel } from "./panel";

vi.mock("../api/client", () => ({
  getAccount: vi.fn(),
  SignedOut: class SignedOut extends Error {},
}));

const people = {
  people: [{
    userId: "user-1",
    displayName: "Ada",
    email: "ada@example.test",
    handle: "@mada",
    name: "mada",
    photo: null,
  }],
};
const thread = {
  you: "mowner",
  peer: "mada",
  messages: [{ id: "m1", clientMessageId: "client-1", text: "hello", mine: true }],
};

it("shows sign-in when the session is missing", async () => {
  vi.mocked(getAccount).mockRejectedValue(new SignedOut());
  render(<MessagingPanel />);
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});

it("lists a person, opens the thread, and sends once", async () => {
  vi.mocked(getAccount).mockResolvedValue({
    authenticated: true,
    user: { id: "user-2", name: "Owner" },
    currentWorkspace: { id: "ws-1", name: "Primary" },
  });
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (String(path).endsWith("/identity/credential")) return Response.json({ name: "mowner" });
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
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "again" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("again")).toBeInTheDocument();
  const posts = fetch.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(String(posts[1]?.[0])).toContain("/cloud/api/v1/workspaces/ws-1/messaging/conversations/mada");
  expect(String(posts[0]?.[0])).toContain("/identity/credential");
});
