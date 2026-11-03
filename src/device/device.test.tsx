import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../app";
import { DevicePage } from "./DevicePage";
import {
  APPROVE_ENDPOINT,
  normalizeUserCode,
  userCodeFromHash,
  workspaceLabel,
} from "./api";

type Call = { method: string; path: string; body: Record<string, unknown> | undefined; init: RequestInit };
let calls: Call[] = [];
let signedIn = true;
let decide: (body: Record<string, unknown>) => { status: number; body: unknown } = () => ({
  status: 200,
  body: { status: "approved" },
});
let lookupStatus = "pending";
let hostName: string | null = "studio-mini";
let approveUnauthorized = false;
let lookupOverride: unknown = null;

const lookupBody = () => ({
  user_code: "BCDF-GHJK",
  client_name: "Agent Relay for macOS",
  desktop_host_name: hostName,
  status: lookupStatus,
  expires_at: "2026-11-03T12:10:00.000Z",
  current_workspace_id: "w1",
  workspaces: [{ id: "w1", name: "Primary", organization_name: "Acme" }],
});

beforeEach(() => {
  calls = [];
  signedIn = true;
  lookupStatus = "pending";
  hostName = "studio-mini";
  approveUnauthorized = false;
  lookupOverride = null;
  decide = () => ({ status: 200, body: { status: "approved" } });
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
      let status = 200;
      let body: unknown = {};
      if (input.startsWith("/cloud/api/auth/session")) {
        if (signedIn) {
          body = {
            authenticated: true,
            user: { id: "u1", name: "Owner" },
            currentWorkspace: { id: "w1", name: "Primary" },
          };
        } else {
          status = 401;
          body = { authenticated: false };
        }
      } else if (input === APPROVE_ENDPOINT) {
        if (!signedIn || approveUnauthorized) {
          status = 401;
        } else if (call.body?.action === "lookup") {
          body = lookupOverride ?? lookupBody();
        } else {
          ({ status, body } = decide(call.body!));
        }
      }
      return new Response(JSON.stringify(body), { status });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("routes #/device to the approval page with the code from verification_uri_complete", async () => {
  window.location.hash = "#/device?user_code=BCDF-GHJK";
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Authorize a device" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Agent Relay Desktop on studio-mini" })).toBeInTheDocument();
});

it("shows the code, client and target workspace, then approves with a same-origin JSON POST", async () => {
  render(<DevicePage initialUserCode="bcdfghjk" />);
  expect(await screen.findByRole("heading", { name: "Agent Relay Desktop on studio-mini" })).toBeInTheDocument();
  expect(screen.getByText("BCDF-GHJK")).toBeInTheDocument();
  expect(screen.getByText("Agent Relay for macOS")).toBeInTheDocument();
  expect(screen.getByText("Primary (Acme)")).toBeInTheDocument();
  const lookup = calls.find((call) => call.body?.action === "lookup")!;
  expect(lookup.body).toEqual({ action: "lookup", user_code: "BCDF-GHJK" });
  expect(lookup.init.credentials).toBe("same-origin");
  expect((lookup.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(await screen.findByRole("heading", { name: "Device approved" })).toBeInTheDocument();
  const approve = calls.find((call) => call.body?.action === "approve")!;
  expect(approve.method).toBe("POST");
  expect(approve.path).toBe("/cloud/api/v1/auth/device/approve");
  expect(approve.body).toEqual({ action: "approve", user_code: "BCDF-GHJK" });
});

it("denies without issuing credentials", async () => {
  hostName = null;
  decide = () => ({ status: 200, body: { status: "denied" } });
  render(<DevicePage initialUserCode="BCDF-GHJK" />);
  expect(await screen.findByRole("heading", { name: "Agent Relay for macOS" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(await screen.findByRole("heading", { name: "Device denied" })).toBeInTheDocument();
  expect(screen.getByText(/No credentials were issued/)).toBeInTheDocument();
});

it("asks for a code when opened without one, and never approves on arrival", async () => {
  render(<DevicePage initialUserCode="" />);
  const input = await screen.findByLabelText("Device code");
  expect(calls.some((call) => call.path === APPROVE_ENDPOINT)).toBe(false);
  fireEvent.change(input, { target: { value: "short" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/8-character code/);
  fireEvent.change(input, { target: { value: "bcdf-ghjk" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
  expect(calls.filter((call) => call.body?.action === "approve")).toHaveLength(0);
});

it("reports a used or expired code instead of offering approval", async () => {
  lookupStatus = "consumed";
  render(<DevicePage initialUserCode="BCDF-GHJK" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("That code has already been used.");
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});

it("surfaces server refusals with a readable message", async () => {
  decide = () => ({ status: 409, body: { error: "already_decided", message: "x" } });
  render(<DevicePage initialUserCode="BCDF-GHJK" />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That code was already used.");
  // A used code can't be decided again: no Approve/Deny next to the refusal.
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
});

it("shows a readable error for an unexpected lookup response", async () => {
  lookupOverride = { user_code: 7 };
  render(<DevicePage initialUserCode="BCDF-GHJK" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The sign-in server sent an unexpected response. Try again.",
  );
});

it("keeps a typed code through sign-in when the session expires", async () => {
  approveUnauthorized = true;
  window.location.hash = "#/device";
  const navigate = vi.fn();
  render(<DevicePage initialUserCode="" navigate={navigate} />);
  fireEvent.change(await screen.findByLabelText("Device code"), {
    target: { value: "bcdfghjk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  const target = new URL(navigate.mock.calls[0]![0] as string, "https://dash.test");
  expect(target.searchParams.get("next")).toBe("/#/device?user_code=BCDF-GHJK");
});

it("names a workspace only when it is known", () => {
  const base = {
    user_code: "BCDF-GHJK",
    client_name: null,
    desktop_host_name: null,
    status: "pending" as const,
    expires_at: "2026-11-03T12:10:00.000Z",
    current_workspace_id: null,
  };
  const two = [
    { id: "w1", name: "Primary", organization_name: "Acme" },
    { id: "w2", name: "Other", organization_name: "Acme" },
  ];
  expect(workspaceLabel({ ...base, workspaces: two })).toBeNull();
  expect(workspaceLabel({ ...base, workspaces: [two[0]!] })).toBe("Primary (Acme)");
  expect(
    workspaceLabel({ ...base, current_workspace_id: "w2", workspaces: two }),
  ).toBe("Other (Acme)");
});

it("sends a signed-out person through login and back to this code", async () => {
  signedIn = false;
  window.location.hash = "#/device?user_code=BCDF-GHJK";
  const navigate = vi.fn();
  render(<DevicePage initialUserCode="BCDF-GHJK" navigate={navigate} />);
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  const target = new URL(navigate.mock.calls[0]![0] as string, "https://dash.test");
  expect(target.pathname).toBe("/login");
  expect(target.searchParams.get("next")).toBe("/#/device?user_code=BCDF-GHJK");
  expect(calls.some((call) => call.path === APPROVE_ENDPOINT)).toBe(false);
});

it("parses codes and hashes", () => {
  expect(normalizeUserCode(" bcdf ghjk ")).toBe("BCDF-GHJK");
  expect(normalizeUserCode("abc")).toBeNull();
  expect(userCodeFromHash("#/device?user_code=BCDF-GHJK")).toBe("BCDF-GHJK");
  expect(userCodeFromHash("#/device")).toBe("");
});
