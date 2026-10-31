import { z } from "zod";
const text = z.string().nullish();
export const accountSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({ id: z.string(), name: text }),
  currentWorkspace: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type Account = z.infer<typeof accountSchema>;
export const sessionsSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string(),
      source: z.string(),
      summary: text,
      lastTs: text,
      project: z.object({ name: z.string() }).nullish(),
    }),
  ),
  nextCursor: z.string().nullable(),
  error: z.boolean(),
});
export type Session = z.infer<typeof sessionsSchema>["items"][number];
