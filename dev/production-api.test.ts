// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createProductionReader,
  upstreamRead,
  localRequestAllowed,
} from "./production-api.mjs";
const tokens = {
  accessToken: "private-access",
  refreshToken: "private-refresh",
  accessTokenExpiresAt: "2099-01-01",
};
const account = {
  authenticated: true,
  user: { id: "u" },
  currentWorkspace: { id: "w", name: "Example" },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const url = (path: string) => new URL(path, "http://localhost");
describe("production development read boundary", () => {
  it("blocks every write and non-session endpoint before loading credentials or fetching", async () => {
    const send = vi.fn(),
      load = vi.fn();
    const read = createProductionReader({ send, load });
    for (const [method, path] of [
      ["POST", "/v1/auth/whoami"],
      ["DELETE", "/v1/workspaces/w/sessions"],
      ["GET", "/v1/workspaces/w/secrets"],
      ["GET", "//evil.example/"],
    ]) {
      expect((await read(url(path), method)).status).toBe(405);
    }
    expect(send).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it("pins production origin and forwards only search/cursor query fields", () => {
    expect(
      upstreamRead(
        url(
          "/v1/workspaces/w/sessions?q=hello&cursor=p&token=secret&metadata=eager",
        ),
        "GET",
      ),
    ).toBe(
      "https://agentrelay.com/cloud/api/v1/workspaces/w/sessions?metadata=deferred&q=hello&cursor=p",
    );
    expect(
      upstreamRead(url("/v1/workspaces/w%2Fother/sessions"), "GET"),
    ).toBeNull();
  });
  it("keeps credentials in upstream headers and preserves the actual account response", async () => {
    const send = vi.fn().mockResolvedValue(json(account));
    const read = createProductionReader({ send, load: async () => tokens });
    const result = await read(url("/auth/session?renew=0"));
    expect(result.body).toEqual({
      ...account,
      workspaces: [account.currentWorkspace],
    });
    expect(JSON.stringify(result)).not.toContain("private-access");
    expect(send.mock.calls[0][1].headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer private-access",
    });
    expect(send.mock.calls[0][1].redirect).toBe("error");
  });
  it("reports missing authorization as setup required, never redirects to local cookie login", async () => {
    const send = vi.fn();
    const read = createProductionReader({
      send,
      load: async () => {
        throw new Error("missing");
      },
    });
    expect(await read(url("/auth/session"))).toEqual({
      status: 503,
      body: { code: "production_login_required" },
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("refreshes the developer credential without exposing it in the response", async () => {
    const save = vi.fn();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        json({ accessToken: "rotated", refreshToken: "refresh-next" }),
      )
      .mockResolvedValueOnce(json(account));
    const read = createProductionReader({
      send,
      save,
      load: async () => ({ ...tokens, accessTokenExpiresAt: "2000-01-01" }),
    });
    expect((await read(url("/v1/auth/whoami"))).body).toEqual(account);
    expect(send.mock.calls[0][0]).toBe(
      "https://agentrelay.com/cloud/api/v1/auth/token/refresh",
    );
    expect(send.mock.calls[1][1].headers.Authorization).toBe("Bearer rotated");
    expect(save).toHaveBeenCalledWith({
      accessToken: "rotated",
      refreshToken: "refresh-next",
    });
  });
});

it("rejects malformed hosts, DNS rebinding and foreign origins", () => {
  expect(
    localRequestAllowed({
      host: "localhost:5174",
      origin: "http://localhost:5174",
    }),
  ).toBe(true);
  for (const headers of [
    { host: "[broken" },
    { host: "attacker.example" },
    { host: "localhost:5174", origin: "https://evil.example" },
    { host: "localhost:5174", "sec-fetch-site": "cross-site" },
  ])
    expect(localRequestAllowed(headers)).toBe(false);
});
