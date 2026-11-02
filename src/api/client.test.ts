import { afterEach, expect, it, vi } from "vitest";
import { getAccount, getSessions, SignedOut } from "./client";
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
it("uses the browser cookie and distinguishes signed-out from an outage", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false })),
    )
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(getAccount(signal())).rejects.toBeInstanceOf(SignedOut);
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  expect(fetch.mock.calls[0][0]).toBe("/cloud/api/auth/session?renew=0");
  await expect(getAccount(signal())).rejects.not.toBeInstanceOf(SignedOut);
});
it("keeps failed history reads distinct from an empty session list", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], nextCursor: null, error: true }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(getSessions("w/other", "page+2", signal())).rejects.toThrow(
    "temporarily unavailable",
  );
  expect(fetch.mock.calls[0][0]).toBe(
    "/cloud/api/v1/workspaces/w%2Fother/sessions?metadata=deferred&cursor=page%2B2",
  );
});
