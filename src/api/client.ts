import { z } from "zod";
import {
  accountSchema,
  sessionsSchema,
  workspacesSchema,
  type Account,
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
  private state: "unknown" | "signed-in" | "signed-out" = "unknown";
  private revision = 0;
  private listeners = new Set<() => void>();
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(
    readonly base: string,
    readonly cloudOrigin: string,
    private send: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    if (!base.startsWith("/") || base.startsWith("//") || /[\\?#]/.test(base))
      throw new Error("Cloud API must use a same-origin path.");
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  get signedIn() {
    return this.state === "signed-in";
  }
  get initialized() {
    return this.state !== "unknown";
  }
  private changed(state: typeof this.state) {
    this.state = state;
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }
  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const revision = this.revision;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await this.send(`${this.base}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        response.status === 401 &&
        revision === this.revision &&
        this.state !== "signed-out"
      )
        this.changed("signed-out");
      const info = z
        .object({ error: z.string().optional(), code: z.string().optional() })
        .safeParse(body);
      throw new ApiError(
        response.status,
        info.success
          ? info.data.code || info.data.error || "request_failed"
          : "request_failed",
      );
    }
    return body;
  }
  async restore(signal?: AbortSignal): Promise<Account | null> {
    const revision = this.revision;
    try {
      const body = await this.request("/auth/session?renew=0", { signal });
      if (revision !== this.revision) return null;
      if (
        z.object({ authenticated: z.literal(false) }).safeParse(body).success
      ) {
        this.changed("signed-out");
        return null;
      }
      const account = accountSchema.parse(body);
      this.changed("signed-in");
      return account;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }
  async account(signal?: AbortSignal) {
    return accountSchema.parse(
      await this.request("/v1/auth/whoami", { signal }),
    );
  }
  async workspaces(signal?: AbortSignal) {
    return workspacesSchema.parse(
      await this.request("/auth/session?renew=0", { signal }),
    );
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutations.then(task, task);
    this.mutations = run.catch(() => undefined);
    return run;
  }
  selectWorkspace(workspaceId: string) {
    return this.serial(async () => {
      await this.request("/auth/workspace", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      });
      this.changed("signed-in");
    });
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
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions?${params}`,
        { signal },
      ),
    );
    if (page.error)
      throw new Error(
        "Session history is temporarily unavailable. Your sessions haven’t been removed.",
      );
    return page;
  }
  logout() {
    return this.serial(async () => {
      await this.request("/auth/logout", { method: "POST" });
      this.changed("signed-out");
    });
  }
}
