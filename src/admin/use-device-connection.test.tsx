import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDeviceConnection } from "./use-device-connection";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

it("a failed restart keeps the outstanding code and keeps polling it", async () => {
  let starts = 0;
  const fetchMock = vi.fn(async (input: string) => {
    if (input.endsWith("/openai-device/start")) {
      starts += 1;
      if (starts === 1) {
        return respond(201, {
          transactionId: "t-1",
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "FIRST-CODE",
          intervalSeconds: 60,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        });
      }
      return respond(503, { error: "unavailable", message: "Provider unavailable" });
    }
    return respond(200, { status: "pending", retryAfterSeconds: 60 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() =>
    useDeviceConnection({ workspaceId: "w1", provider: "openai", label: "Codex" }),
  );
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.state).toBe("waiting");
  expect(result.current.connection?.userCode).toBe("FIRST-CODE");
  await act(async () => {
    await result.current.start();
  });
  await waitFor(() => expect(result.current.error).toBe("Provider unavailable"));
  expect(result.current.state).toBe("waiting");
  expect(result.current.connection?.userCode).toBe("FIRST-CODE");
});

it("a permanent poll failure stops polling instead of retrying until expiry", async () => {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.endsWith("/start")) {
      return respond(201, {
        transactionId: "t-2",
        verificationUri: "https://accounts.x.ai/oauth2/device",
        userCode: "CODE",
        intervalSeconds: 1,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    }
    return respond(404, { error: "device_session_not_found", message: "Login not found. Start again." });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useDeviceConnection({ workspaceId: "w1", provider: "xai", label: "Grok" }));
  await act(async () => {
    await result.current.start();
  });
  await waitFor(() => expect(result.current.state).toBe("idle"), { timeout: 4000 });
  expect(result.current.error).toBe("Login not found. Start again.");
  const polls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/status")).length;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/status")).length).toBe(polls);
});
