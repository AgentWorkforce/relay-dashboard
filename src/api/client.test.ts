import { describe, expect, it, vi } from "vitest";
import { CloudClient } from "./client";
import { previewAccount } from "../preview";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("same-origin browser session", () => {
  it("restores the existing cookie session without minting a token", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => json(previewAccount));
    const client = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await client.restore();
    expect(client.signedIn).toBe(true);
    expect(send).toHaveBeenCalledWith(
      "/cloud/api/auth/session?renew=0",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(
      new Headers(send.mock.calls[0][1]?.headers).has("Authorization"),
    ).toBe(false);
    const reloaded = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await reloaded.restore();
    expect(reloaded.signedIn).toBe(true);
  });
  it("distinguishes a signed-out session from an unavailable backend", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(json({ authenticated: false }));
    const client = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await expect(client.restore()).rejects.toMatchObject({ status: 503 });
    expect(client.initialized).toBe(false);
    await client.restore();
    expect(client.initialized).toBe(true);
    expect(client.signedIn).toBe(false);
  });
  it("does not claim logout succeeded when the cookie could not be cleared", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(previewAccount))
      .mockResolvedValueOnce(json({}, 503));
    const client = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await client.restore();
    await expect(client.logout()).rejects.toMatchObject({ status: 503 });
    expect(client.signedIn).toBe(true);
  });
  it("serializes cookie-changing operations so a late switch cannot undo logout", async () => {
    let finish!: (value: Response) => void;
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(previewAccount))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await client.restore();
    const switcher = client.selectWorkspace("other");
    const logout = client.logout();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    finish(json(previewAccount));
    await Promise.all([switcher, logout]);
    expect(send.mock.calls[2][0]).toBe("/cloud/api/auth/logout");
    expect(client.signedIn).toBe(false);
  });
  it("rejects cross-origin credential destinations", () => {
    expect(
      () =>
        new CloudClient("https://evil.example/api", "https://agentrelay.com"),
    ).toThrow("same-origin");
    expect(
      () => new CloudClient("//evil.example/api", "https://agentrelay.com"),
    ).toThrow("same-origin");
  });
  it("invalidates the session when an API returns 401", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(previewAccount))
      .mockResolvedValueOnce(json({}, 401));
    const client = new CloudClient(
      "/cloud/api",
      "https://agentrelay.com",
      send,
    );
    await client.restore();
    await expect(client.account()).rejects.toMatchObject({ status: 401 });
    expect(client.signedIn).toBe(false);
  });
});
