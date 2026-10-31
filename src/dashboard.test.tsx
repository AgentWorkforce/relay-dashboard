import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./dashboard";
import { CloudClient } from "./api/client";
import { previewAccount, previewSessions } from "./preview";
vi.mock("./auth/login", () => ({
  Login: () => <a href="/login?next=%2Fdashboard%2F">Sign in</a>,
}));
function setup(preview = true) {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ authenticated: false })));
  const client = new CloudClient("/cloud-api", "https://agentrelay.com", send);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Dashboard
        client={client}
        preview={
          preview
            ? { account: previewAccount, sessions: previewSessions }
            : undefined
        }
      />
    </QueryClientProvider>,
  );
  return { send, user: userEvent.setup() };
}
describe("dashboard review flow", () => {
  it("checks the browser session before sending visitors to the real login page", async () => {
    const { send } = setup(false);
    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login?next=%2Fdashboard%2F");
    expect(send.mock.calls[0][0]).toBe("/cloud-api/auth/session?renew=0");
  });
  it("labels the preview, searches and clears filters without sending requests", async () => {
    const { user, send } = setup();
    expect(screen.getByText("Preview · sample data")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Tighten the onboarding flow" });
    await user.type(
      screen.getByRole("textbox", { name: "Search sessions" }),
      "webhook",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Tighten the onboarding flow" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", {
        name: "Add retry handling to webhook delivery",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0]!,
    );
    await screen.findByRole("button", { name: "Tighten the onboarding flow" });
    expect(send).not.toHaveBeenCalled();
  });
  it("opens an accessible detail panel and supports closing with Escape", async () => {
    const { user } = setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Tighten the onboarding flow",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Sample session — no live conversation."),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

it("renders authenticated API sessions and clears them on sign-out", async () => {
  const send = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    const body = path.includes("/auth/session")
      ? { ...previewAccount, workspaces: [previewAccount.currentWorkspace] }
      : path.endsWith("/whoami")
        ? previewAccount
        : path.includes("/sessions?")
          ? {
              items: [previewSessions[0]],
              nextCursor: null,
              error: false,
              members: [],
            }
          : { ok: true };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const client = new CloudClient("/cloud-api", "https://agentrelay.com", send);
  await client.restore();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <Dashboard client={client} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Tighten the onboarding flow" });
  expect(screen.queryByText("Preview · sample data")).not.toBeInTheDocument();
  const call = send.mock.calls.find(([url]) =>
    String(url).includes("/sessions?"),
  );
  expect(new Headers(call?.[1]?.headers).get("Authorization")).toBeNull();
  await act(() => client.logout());
  await screen.findByRole("link", { name: "Sign in" });
  expect(
    screen.queryByRole("button", { name: "Tighten the onboarding flow" }),
  ).not.toBeInTheDocument();
  expect(cache.getQueryCache().getAll()).toHaveLength(0);
});
