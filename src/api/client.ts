import { z } from "zod";
import {
  accountSchema,
  deviceSchema,
  deviceTokensSchema,
  sessionsSchema,
  tokensSchema,
  workspacesSchema,
  type Tokens,
  type Device,
} from "./contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public interval?: number,
  ) {
    super(
      status === 401
        ? "Your session has expired. Sign in again."
        : status === 403
          ? "You don’t have access to this workspace."
          : code === "history_customer_hosted"
            ? "This workspace keeps its sessions in its own RelayHistory."
            : status === 429
              ? "Cloud is busy. Wait a moment, then try again."
              : "Cloud couldn’t complete this request. Try again.",
    );
  }
}

export class CloudClient {
  private tokens: Tokens | null = null;
  private revision = 0;
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    readonly base: string,
    readonly cloudOrigin: string,
    private send: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    const url = new URL(base, "http://localhost");
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (!base.startsWith("/") &&
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      throw new Error("Use an HTTPS API URL or a local development endpoint.");
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  get signedIn() {
    return this.tokens !== null;
  }
  private setTokens(tokens: Tokens | null) {
    this.tokens = tokens;
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }

  private async request(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
      ...init.headers,
    });
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await this.send(`${this.base}${path}`, {
        ...init,
        headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(
        "Can’t reach Cloud. Check your connection and try again.",
        { cause: error },
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const info = z
        .object({
          error: z.string().optional(),
          code: z.string().optional(),
          interval: z.number().optional(),
        })
        .safeParse(body);
      throw new ApiError(
        response.status,
        info.success
          ? info.data.code || info.data.error || "request_failed"
          : "request_failed",
        info.success ? info.data.interval : undefined,
      );
    }
    return body;
  }
  private async authorized(path: string, init?: RequestInit): Promise<unknown> {
    const token = this.tokens?.accessToken;
    const revision = this.revision;
    if (!token) throw new ApiError(401, "signed_out");
    try {
      return await this.request(path, init, token);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 401 ||
        revision !== this.revision
      )
        throw error;
      if (!this.refreshing) {
        this.refreshing = this.refresh(revision).finally(() => {
          this.refreshing = null;
        });
      }
      await this.refreshing;
      if (!this.tokens || revision !== this.revision)
        throw new ApiError(401, "signed_out");
      return this.request(path, init, this.tokens.accessToken);
    }
  }
  private async refresh(revision: number) {
    try {
      const next = tokensSchema.parse(
        await this.request("/auth/token/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: this.tokens?.refreshToken }),
        }),
      );
      if (this.revision === revision) this.tokens = next;
    } catch (error) {
      if (
        this.revision === revision &&
        error instanceof ApiError &&
        [400, 401, 403].includes(error.status)
      )
        this.setTokens(null);
      throw error;
    }
  }
  async startLogin(signal: AbortSignal): Promise<Device> {
    const device = deviceSchema.parse(
      await this.request("/auth/device/start", {
        method: "POST",
        body: JSON.stringify({ client_name: "Agent Relay Dashboard" }),
        signal,
      }),
    );
    const verification = new URL(device.verification_uri_complete);
    if (
      verification.origin !== this.cloudOrigin ||
      verification.pathname !== "/cloud/device"
    )
      throw new Error("Cloud returned an unexpected sign-in destination.");
    return device;
  }
  async finishLogin(device: Device, signal: AbortSignal) {
    const revision = this.revision;
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = Math.max(5, device.interval);
    while (Date.now() < deadline) {
      await delay(interval * 1000, signal);
      try {
        const tokens = deviceTokensSchema.parse(
          await this.request("/auth/device/token", {
            method: "POST",
            body: JSON.stringify({
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              device_code: device.device_code,
            }),
            signal,
          }),
        );
        if (!signal.aborted && revision === this.revision)
          this.setTokens(tokens);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.code === "authorization_pending")
          continue;
        if (error instanceof ApiError && error.code === "slow_down") {
          interval = Math.max(interval + 5, error.interval || 0);
          continue;
        }
        if (error instanceof ApiError && error.status >= 500) {
          interval = Math.min(60, interval + 5);
          continue;
        }
        if (error instanceof ApiError && error.code === "access_denied")
          throw new Error(
            "Sign-in was declined. You can try again whenever you’re ready.",
            { cause: error },
          );
        throw error;
      }
    }
    throw new Error("This sign-in code expired. Start again to get a new one.");
  }
  async account(signal?: AbortSignal) {
    return accountSchema.parse(
      await this.authorized("/auth/whoami", { signal }),
    );
  }
  async workspaces(signal?: AbortSignal) {
    return workspacesSchema.parse(
      await this.authorized("/auth/desktop/workspaces", { signal }),
    );
  }
  async selectWorkspace(workspaceId: string) {
    const revision = this.revision;
    const next = tokensSchema.parse(
      await this.authorized("/auth/desktop/workspaces", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      }),
    );
    if (revision === this.revision) this.setTokens(next);
  }
  async sessions(
    workspaceId: string,
    q: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({ metadata: "deferred" });
    if (q.trim()) params.set("q", q.trim());
    if (cursor) params.set("cursor", cursor);
    const page = sessionsSchema.parse(
      await this.authorized(
        `/workspaces/${encodeURIComponent(workspaceId)}/sessions?${params}`,
        { signal },
      ),
    );
    if (page.error)
      throw new Error(
        "Session history is temporarily unavailable. Your sessions haven’t been removed.",
      );
    return page;
  }
  async logout() {
    const token = this.tokens?.refreshToken;
    this.setTokens(null);
    if (token)
      await this.request("/auth/token/revoke", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
  }
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
