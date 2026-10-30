import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudClient } from "./client";
const tokens = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  access_token_expires_at: "2030-01-01",
  refresh_token_expires_at: "2030-02-01",
};
const device = {
  device_code: "test-device",
  user_code: "TEST-CODE",
  verification_uri_complete:
    "https://agentrelay.com/cloud/device?user_code=TEST-CODE",
  expires_in: 600,
  interval: 5,
};
const account = {
  authenticated: true,
  user: { id: "person", name: "Alex" },
  currentWorkspace: { id: "w", name: "Workspace", organization_id: "o" },
  currentOrganization: { id: "o", name: "Org" },
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
async function login(client: CloudClient) {
  const promise = client.finishLogin(device, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000);
  await promise;
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Cloud client authentication", () => {
  it("invokes browser fetch with its global receiver", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async function (
      this: typeof globalThis,
    ) {
      expect(this).toBe(globalThis);
      return json(device);
    });
    const client = new CloudClient("/cloud-api", "https://agentrelay.com");
    expect(
      (await client.startLogin(new AbortController().signal)).user_code,
    ).toBe("TEST-CODE");
  });
  it("waits for consent, backs off, then lists with a bearer and no cookies", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(device))
      .mockResolvedValueOnce(json({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(json({ error: "slow_down", interval: 10 }, 400))
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json(account));
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      send,
    );
    const grant = await client.startLogin(new AbortController().signal);
    const pending = client.finishLogin(grant, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.signedIn).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect((await client.account()).user.id).toBe("person");
    const init = send.mock.calls.at(-1)![1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-access",
    );
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });
  it("shares a refresh across concurrent unauthorized reads", async () => {
    vi.useFakeTimers();
    let refreshed = false;
    const send = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith("/device/token")) return json(tokens);
      if (String(url).endsWith("/token/refresh")) {
        refreshed = true;
        return json({
          accessToken: "new",
          refreshToken: "next",
          accessTokenExpiresAt: "2030-01-01",
          refreshTokenExpiresAt: "2030-02-01",
        });
      }
      if (
        new Headers(init?.headers).get("Authorization") === "Bearer test-access"
      )
        return json({ error: "Unauthorized" }, 401);
      return json(account);
    });
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      send,
    );
    await login(client);
    await Promise.all([client.account(), client.account()]);
    expect(refreshed).toBe(true);
    expect(
      send.mock.calls.filter(([url]) => String(url).endsWith("/token/refresh")),
    ).toHaveLength(1);
  });
  it("cannot restore a signed-out session with a late refresh", async () => {
    vi.useFakeTimers();
    let resolveRefresh!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/device/token")) return json(tokens);
      if (String(url).endsWith("/token/refresh"))
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      if (String(url).endsWith("/token/revoke")) return json({ revoked: true });
      return json({ error: "Unauthorized" }, 401);
    });
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      send,
    );
    await login(client);
    const read = client.account();
    const rejected = expect(read).rejects.toMatchObject({ status: 401 });
    await vi.advanceTimersByTimeAsync(1);
    await client.logout();
    resolveRefresh(
      json({
        accessToken: "new",
        refreshToken: "next",
        accessTokenExpiresAt: "2030",
        refreshTokenExpiresAt: "2030",
      }),
    );
    await rejected;
    expect(client.signedIn).toBe(false);
  });
  it("rejects a substituted approval destination", async () => {
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          ...device,
          verification_uri_complete: "https://evil.example/cloud/device",
        }),
      ),
    );
    await expect(
      client.startLogin(new AbortController().signal),
    ).rejects.toThrow("unexpected sign-in destination");
  });
  it("cancels polling without establishing a session", async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      send,
    );
    const pending = client.finishLogin(device, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    expect(send).not.toHaveBeenCalled();
    expect(client.signedIn).toBe(false);
  });
  it("preserves workspace identity and refuses an upstream outage disguised as an empty page", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(
        json({ items: [], members: [], nextCursor: null, error: true }),
      );
    const client = new CloudClient(
      "/cloud-api",
      "https://agentrelay.com",
      send,
    );
    await login(client);
    await expect(
      client.sessions("w/other", "find me", "page+2"),
    ).rejects.toThrow("temporarily unavailable");
    expect(String(send.mock.calls.at(-1)![0])).toContain(
      "/workspaces/w%2Fother/sessions?metadata=deferred&q=find+me&cursor=page%2B2",
    );
  });
});
