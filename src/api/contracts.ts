import { z } from "zod";

const text = z.string().nullable().optional();
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
