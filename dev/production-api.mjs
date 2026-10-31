import { readFile, writeFile, mkdir, stat, chmod } from "node:fs/promises";
import path from "node:path";

export const productionOrigin = "https://agentrelay.com";
export const credentialPath = path.resolve(".local/production-auth.json");
export async function saveCredentials(tokens, file = credentialPath) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(tokens), { mode: 0o600 });
  await chmod(file, 0o600);
}
export async function loadCredentials(file = credentialPath) {
  const info = await stat(file);
  if (process.platform !== "win32" && info.mode & 0o077)
    throw new Error("Credential file must be private (chmod 600).");
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string"
  )
    throw new Error("Invalid credentials");
  return value;
}

// A deliberately smaller surface than Cloud: no arbitrary URLs, methods or headers.
export function upstreamRead(url, method) {
  if (method !== "GET") return null;
  const pathname = url.pathname;
  let target;
  if (pathname === "/auth/session" || pathname === "/v1/auth/whoami")
    target = "/v1/auth/whoami";
  else if (/^\/v1\/workspaces\/[a-zA-Z0-9_-]+\/sessions$/.test(pathname))
    target = pathname;
  else return null;
  const params = new URLSearchParams();
  if (target.endsWith("/sessions")) {
    params.set("metadata", "deferred");
    for (const key of ["q", "cursor"])
      if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key));
  }
  return `${productionOrigin}/cloud/api${target}${params.size ? `?${params}` : ""}`;
}

export function createProductionReader({
  send = (...args) => globalThis.fetch(...args),
  load = loadCredentials,
  save = saveCredentials,
} = {}) {
  let refresh;
  async function renew(tokens) {
    if (!refresh)
      refresh = (async () => {
        const response = await send(
          `${productionOrigin}/cloud/api/v1/auth/token/refresh`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: tokens.refreshToken }),
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) throw new Error("production_login_required");
        const next = await response.json();
        if (
          typeof next.accessToken !== "string" ||
          typeof next.refreshToken !== "string"
        )
          throw new Error("production_login_required");
        await save(next);
        return next;
      })().finally(() => {
        refresh = undefined;
      });
    return refresh;
  }
  return async (url, method = "GET") => {
    const target = upstreamRead(url, method);
    if (!target)
      return {
        status: 405,
        body: {
          error: "Production development mode allows session reads only",
        },
      };
    let tokens;
    try {
      tokens = await load();
    } catch {
      return { status: 503, body: { code: "production_login_required" } };
    }
    const get = (tokens) =>
      send(target, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
    try {
      // Refresh only the local developer credential; no product data writes.
      if (Date.parse(tokens.accessTokenExpiresAt) <= Date.now() + 30000)
        tokens = await renew(tokens);
      let response = await get(tokens);
      if (response.status === 401) response = await get(await renew(tokens));
      if (!response.ok)
        return {
          status: response.status === 401 ? 503 : response.status,
          body: {
            code:
              response.status === 401
                ? "production_login_required"
                : "production_read_failed",
          },
        };
      const body = await response.json();
      if (url.pathname === "/auth/session")
        return {
          status: 200,
          body: {
            ...body,
            workspaces: body.currentWorkspace ? [body.currentWorkspace] : [],
          },
        };
      return { status: 200, body };
    } catch (error) {
      return {
        status: 503,
        body: {
          code:
            error.message === "production_login_required"
              ? "production_login_required"
              : "production_read_failed",
        },
      };
    }
  };
}

export function localRequestAllowed(headers) {
  try {
    const host = new URL(`http://${headers.host || "invalid"}`);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) &&
      (!headers.origin || new URL(headers.origin).host === host.host) &&
      headers["sec-fetch-site"] !== "cross-site"
    );
  } catch {
    return false;
  }
}

export function productionApiPlugin() {
  const read = createProductionReader();
  return {
    name: "production-read-only-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/dashboard/__production-api",
        async (req, res) => {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Content-Type-Options", "nosniff");
          // Reject DNS rebinding and cross-site requests. No CORS opt-in.
          if (!localRequestAllowed(req.headers)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "Local same-origin access only" }));
            return;
          }
          const result = await read(
            new URL(req.url || "/", "http://localhost"),
            req.method,
          );
          res.statusCode = result.status;
          res.end(JSON.stringify(result.body));
        },
      );
    },
  };
}
