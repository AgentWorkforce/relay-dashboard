import { z } from "zod";

const text = z.string().nullable().optional();
export const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.string(),
  refreshTokenExpiresAt: z.string(),
});
export type Tokens = z.infer<typeof tokensSchema>;
export const deviceSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri_complete: z.url(),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
});
export type Device = z.infer<typeof deviceSchema>;
export const deviceTokensSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    access_token_expires_at: z.string(),
    refresh_token_expires_at: z.string(),
  })
  .transform((v) => ({
    accessToken: v.access_token,
    refreshToken: v.refresh_token,
    accessTokenExpiresAt: v.access_token_expires_at,
    refreshTokenExpiresAt: v.refresh_token_expires_at,
  }));
export const accountSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({ id: z.string(), name: text, email: text, avatarUrl: text }),
  currentWorkspace: z
    .object({ id: z.string(), name: z.string(), organization_id: z.string() })
    .nullable(),
  currentOrganization: z
    .object({ id: z.string(), name: z.string() })
    .nullable(),
});
export type Account = z.infer<typeof accountSchema>;
export const workspacesSchema = z.object({
  workspaces: z.array(
    z.object({ id: z.string(), name: z.string(), organization_name: text }),
  ),
});
export const sessionSchema = z.object({
  sessionId: z.string(),
  source: z.string(),
  summary: text,
  lastTs: text,
  createdAt: text,
  model: text,
  reasoning: text,
  projectId: text,
  project: z
    .object({ key: z.string(), name: z.string(), detail: z.string() })
    .nullable()
    .optional(),
  eventCount: z.number().nullable().optional(),
  costUsdMicros: z.number().nullable().optional(),
  userIds: z.array(z.string()).default([]),
  machineIds: z.array(z.string()).default([]),
  workState: z
    .object({
      status: z.enum(["active", "idle", "finished"]),
      updatedAt: z.string(),
    })
    .nullable()
    .optional(),
  pullRequest: z
    .object({ url: z.string(), number: z.string() })
    .nullable()
    .optional(),
});
export type Session = z.infer<typeof sessionSchema>;
export const sessionsSchema = z.object({
  items: z.array(sessionSchema),
  nextCursor: z.string().nullable(),
  error: z.boolean(),
  members: z
    .array(z.object({ id: z.string(), name: z.string(), avatarUrl: text }))
    .default([]),
});
