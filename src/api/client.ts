export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? "Sign in to continue." : status === 403
      ? "You do not have access to this resource."
      : `Cloud request failed (${status}).`);
    this.name = "ApiError";
  }
}

export function normalizeApiBase(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Use HTTPS for Cloud, or HTTP on localhost.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The API URL must not contain credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

type Auth =
  | { kind: "cookie" }
  | { kind: "bearer"; getAccessToken: () => Promise<string | null> };

/** Transport only. Feature modules must validate their own response contracts. */
export function createApiClient(options: {
  baseUrl: string;
  auth: Auth;
  fetch?: typeof fetch;
}) {
  const base = normalizeApiBase(options.baseUrl);
  const send = options.fetch ?? globalThis.fetch;
  return {
    async get(path: string, signal?: AbortSignal): Promise<unknown> {
      if (!path.startsWith("/") || path.startsWith("//")) {
        throw new Error("Use an API-relative path starting with a single slash.");
      }
      const url = new URL(`${base}${path}`);
      if (url.origin !== new URL(base).origin || !url.pathname.startsWith(`${new URL(base).pathname}/`)) {
        throw new Error("Request path must stay within the API base.");
      }
      const headers = new Headers({ Accept: "application/json" });
      if (options.auth.kind === "bearer") {
        const token = await options.auth.getAccessToken();
        if (!token) throw new ApiError(401);
        headers.set("Authorization", `Bearer ${token}`);
      }
      const response = await send(url, {
        method: "GET", headers, signal,
        credentials: options.auth.kind === "cookie" ? "same-origin" : "omit",
        redirect: "error",
      });
      if (!response.ok) throw new ApiError(response.status);
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Cloud returned an unexpected response. Check the API URL.");
      }
      return response.json();
    },
  };
}
