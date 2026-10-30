import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, normalizeApiBase } from "./client";

const baseUrl = "https://cloud.example/api/v1";
const json = () => new Response('{"items":[]}', { headers: { "Content-Type": "application/json" } });

describe("Cloud transport boundary", () => {
  it("uses an injected bearer without ambient cookies and propagates cancellation", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json());
    const controller = new AbortController();
    const client = createApiClient({ baseUrl, auth: { kind: "bearer", getAccessToken: async () => "test-token" }, fetch: send });
    await expect(client.get("/workspaces/w/sessions", controller.signal)).resolves.toEqual({ items: [] });
    const [url, init] = send.mock.calls[0]!;
    expect(String(url)).toBe(`${baseUrl}/workspaces/w/sessions`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", signal: controller.signal });
  });

  it("does not issue a request without a bearer", async () => {
    const send = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl, auth: { kind: "bearer", getAccessToken: async () => null }, fetch: send });
    await expect(client.get("/sessions")).rejects.toMatchObject({ status: 401 });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps cookies same-origin and does not invent a bearer", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json());
    await createApiClient({ baseUrl, auth: { kind: "cookie" }, fetch: send }).get("/sessions");
    const init = send.mock.calls[0]![1];
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it.each(["//other.example/data", "https://other.example", "/../../private", "/%2e%2e/%2e%2e/private"])("rejects a path escaping the API: %s", async (path) => {
    const send = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl, auth: { kind: "cookie" }, fetch: send });
    await expect(client.get(path)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns status errors without reflecting backend content", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("private diagnostic", { status: 403 }));
    const client = createApiClient({ baseUrl, auth: { kind: "cookie" }, fetch: send });
    await expect(client.get("/sessions")).rejects.toEqual(new ApiError(403));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects a login page returned as a successful HTML response", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(createApiClient({ baseUrl, auth: { kind: "cookie" }, fetch: send }).get("/sessions")).rejects.toThrow("unexpected response");
  });
});

describe("API configuration", () => {
  it.each(["http://cloud.example/api", "https://user:secret@cloud.example/api", "https://cloud.example/api?token=x", "https://cloud.example/api#secret", "file:///api"])("rejects unsafe configuration: %s", (url) => {
    expect(() => normalizeApiBase(url)).toThrow();
  });
  it("accepts HTTPS and local development, removing the trailing slash", () => {
    expect(normalizeApiBase(`${baseUrl}/`)).toBe(baseUrl);
    expect(normalizeApiBase("http://127.0.0.1:3000/api/v1")).toBe("http://127.0.0.1:3000/api/v1");
  });
});
