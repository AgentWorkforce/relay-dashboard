import type { z } from "zod";
import {
  adminContextSchema,
  apiTokensSchema,
  createdTokenSchema,
  envVarListSchema,
  envVarSchema,
  membersSchema,
  providersSchema,
  workspacesSchema,
  type TokenPurpose,
  type Role,
} from "./contracts";

export class SignedOut extends Error {}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const base = "/cloud/api";
const enc = encodeURIComponent;

async function call<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    signal: init.signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (response.status === 401) throw new SignedOut();
  const text = response.status === 204 ? "" : await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      response.status,
      detail.error ?? "request_failed",
      detail.message ??
        (response.status === 403
          ? "Only organization owners and admins can do that."
          : "Something went wrong. Please try again."),
    );
  }
  return schema ? schema.parse(body) : (body as T);
}

const ws = (id: string) => `/v1/workspaces/${enc(id)}`;

export const adminApi = {
  context: (signal?: AbortSignal) =>
    call("/v1/auth/whoami", adminContextSchema, { signal }),

  listEnv: async (workspace: string, signal?: AbortSignal) =>
    (await call(`${ws(workspace)}/secrets`, envVarListSchema, { signal })).data
      .items,
  putEnv: (workspace: string, name: string, value: string) =>
    call(`${ws(workspace)}/secrets`, envVarSchema, {
      method: "POST",
      body: { name, envVar: name, value, kind: "environment" },
    }),
  deleteEnv: (workspace: string, name: string) =>
    call(`${ws(workspace)}/secrets/${enc(name)}`, envVarSchema, {
      method: "DELETE",
    }),

  providers: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/integrations/providers`, providersSchema, {
      signal,
    }),
  putOAuthApp: (
    workspace: string,
    provider: string,
    input: { clientId: string; clientSecret?: string; scopes: string[] | null },
  ) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}/oauth-app`, null, {
      method: "PUT",
      body: input,
    }),
  deleteOAuthApp: (workspace: string, provider: string) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}/oauth-app`, null, {
      method: "DELETE",
    }),
  connectSession: async (workspace: string, provider: string) =>
    (await call(`${ws(workspace)}/integrations/connect-session`, null, {
      method: "POST",
      body: { allowedIntegrations: [provider] },
    })) as { connectLink: string },
  connectApiKey: (
    workspace: string,
    provider: string,
    credentials: Record<string, string>,
  ) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}`, null, {
      method: "POST",
      body: { credentials },
    }),
  disconnect: (workspace: string, provider: string) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}`, null, {
      method: "DELETE",
    }),

  listTokens: async (workspace: string, signal?: AbortSignal) =>
    (
      await call(`${ws(workspace)}/deployment-api-tokens`, apiTokensSchema, {
        signal,
      })
    ).tokens,
  createToken: (
    workspace: string,
    input: {
      label: string;
      purpose: TokenPurpose;
      expiryDays?: number;
      neverExpires?: boolean;
    },
  ) =>
    call(`${ws(workspace)}/deployment-api-tokens`, createdTokenSchema, {
      method: "POST",
      body: input,
    }),
  revokeToken: (workspace: string, id: string) =>
    call(`${ws(workspace)}/deployment-api-tokens/${enc(id)}`, null, {
      method: "DELETE",
    }),

  members: async (organization: string, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/memberships`,
        membersSchema,
        {
          signal,
        },
      )
    ).memberships,
  putMember: (
    organization: string,
    input: { email: string; name: string; role: Role },
  ) =>
    call(`/v1/organizations/${enc(organization)}/memberships`, null, {
      method: "POST",
      body: input,
    }),
  removeMember: (organization: string, userId: string) =>
    call(
      `/v1/organizations/${enc(organization)}/memberships/${enc(userId)}`,
      null,
      { method: "DELETE" },
    ),
  workspaces: async (organization: string, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/workspaces`,
        workspacesSchema,
        {
          signal,
        },
      )
    ).workspaces,
  renameOrganization: (organization: string, name: string) =>
    call(`/v1/organizations/${enc(organization)}`, null, {
      method: "PATCH",
      body: { name },
    }),
};

export const canManage = (role: Role) => role === "owner" || role === "admin";
