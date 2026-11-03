// Session reads against the control plane (`/cloud/api/v1/workspaces/:id/sessions…`).
// The control plane scopes every read to the signed-in workspace.
import { z } from "zod";
import { read } from "../api/client";
import { sessionRow, type Member, type SessionRow } from "./data";

const record = z.record(z.string(), z.unknown());
const members = z
  .array(z.object({ id: z.string(), name: z.string().nullish() }))
  .default([])
  .transform((rows): Member[] =>
    rows.map((row) => ({ id: row.id, name: row.name ?? null })),
  );
const cursor = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const listSchema = z.object({
  items: z.array(
    record.refine(
      (row) =>
        typeof row.sessionId === "string" && typeof row.source === "string",
    ),
  ),
  members,
  nextCursor: cursor,
  error: z.boolean(),
  now: z.string().nullish(),
});

export type SessionPage = {
  items: SessionRow[];
  members: Member[];
  nextCursor: string | null;
  now: string | null;
};

export class HistoryUnavailable extends Error {
  constructor() {
    super("Session history is temporarily unavailable. Please try again.");
  }
}

const path = (workspace: string, suffix = "") =>
  `/v1/workspaces/${encodeURIComponent(workspace)}/sessions${suffix}`;

function query(entries: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(entries)) {
    if (value) params.set(name, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type ListFilters = {
  q?: string;
  source?: string;
  project?: string;
  since?: string;
  until?: string;
};

export async function listSessions(
  workspace: string,
  filters: ListFilters,
  next: string | null,
  signal: AbortSignal,
): Promise<SessionPage> {
  const page = listSchema.parse(
    await read(
      path(
        workspace,
        query({
          metadata: "deferred",
          q: filters.q,
          source: filters.source,
          project: filters.project,
          since: filters.since,
          until: filters.until,
          cursor: next,
        }),
      ),
      signal,
    ),
  );
  if (page.error) throw new HistoryUnavailable();
  return {
    items: page.items.map(sessionRow),
    members: page.members,
    nextCursor: page.nextCursor,
    now: page.now ?? null,
  };
}

const eventSchema = record.refine(
  (row) => typeof row.eventId === "string" && typeof row.ts === "string",
);

export type SearchMatch = {
  eventId: string;
  sessionId: string | null;
  source: string | null;
  ts: string;
  kind: string | null;
  actorRole: string | null;
  actorName: string | null;
  userId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  toolName: string | null;
  content: string | null;
  contentTruncated: boolean;
  citationPath: string | null;
};

const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

export async function searchSessions(
  workspace: string,
  filters: ListFilters,
  next: string | null,
  signal: AbortSignal,
) {
  const body = z
    .object({ matches: z.array(eventSchema), members, nextCursor: cursor })
    .parse(
      await read(
        path(
          workspace,
          query({
            q: filters.q,
            source: filters.source,
            project: filters.project,
            since: filters.since,
            until: filters.until,
            cursor: next,
          }),
        ).replace("/sessions?", "/sessions/search?"),
        signal,
      ),
    );
  return {
    matches: body.matches.map((row): SearchMatch => ({
      eventId: String(row.eventId),
      sessionId: text(row.sessionId),
      source: text(row.source),
      ts: String(row.ts),
      kind: text(row.kind),
      actorRole: text(row.actorRole),
      actorName: text(row.actorName),
      userId: text(row.userId),
      taskTitle: text(row.taskTitle),
      projectId: text(row.projectId),
      toolName: text(row.toolName),
      content: text(row.content),
      contentTruncated: row.contentTruncated === true,
      citationPath: text(row.citationPath),
    })),
    members: body.members,
    nextCursor: body.nextCursor,
  };
}

export type ActivityDay = {
  date: string;
  conversations: number;
  bySource: Record<string, number>;
};

export async function sessionActivity(
  workspace: string,
  range: { first: string; last: string; q?: string },
  signal: AbortSignal,
): Promise<ActivityDay[]> {
  return z
    .object({
      days: z.array(
        z.object({
          date: z.string(),
          conversations: z.number(),
          bySource: z.record(z.string(), z.number()),
        }),
      ),
    })
    .parse(await read(path(workspace, `/activity${query(range)}`), signal))
    .days;
}

export type SessionOutput = {
  agentMessages: number;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  commitsWithoutLineCounts: number;
};

export async function sessionOutput(
  workspace: string,
  range: { first: string; last: string },
  signal: AbortSignal,
): Promise<SessionOutput | null> {
  const body = z
    .object({
      output: z
        .object({
          agentMessages: z.number(),
          commits: z.number(),
          linesAdded: z.number(),
          linesRemoved: z.number(),
          commitsWithoutLineCounts: z.number(),
        })
        .nullable(),
    })
    .parse(await read(path(workspace, `/output${query(range)}`), signal));
  return body.output;
}

const sessionPath = (workspace: string, sessionId: string, resource: string) =>
  path(workspace, `/${encodeURIComponent(sessionId)}/${resource}`);

export async function sessionEvents(
  workspace: string,
  session: { sessionId: string; source: string },
  next: string | null,
  signal: AbortSignal,
) {
  const body = z
    .object({ events: z.array(eventSchema), members, nextCursor: cursor })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "events")}${query({
          source: session.source,
          limit: "500",
          cursor: next,
        })}`,
        signal,
      ),
    );
  return body;
}

export async function sessionTurns(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
) {
  return z
    .object({ turns: z.array(record), nextCursor: cursor })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "turns")}${query({ source: session.source })}`,
        signal,
      ),
    );
}

export type SessionTiming = {
  startedAt: string | null;
  lastActionAt: string | null;
  workMs: number | null;
  waitingMs: number | null;
  coverage?: Record<string, unknown>;
};

export async function sessionTiming(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
): Promise<SessionTiming | null> {
  return z
    .object({
      timing: z
        .object({
          startedAt: z.string().nullable(),
          lastActionAt: z.string().nullable(),
          workMs: z.number().nullable(),
          waitingMs: z.number().nullable(),
          coverage: record.optional(),
        })
        .nullable(),
    })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "timing")}${query({ source: session.source })}`,
        signal,
      ),
    ).timing;
}

export type SessionEdge = {
  parentSessionId: string;
  childSessionId: string;
  relationship: string | null;
  childAgentType: string | null;
  childAgentName: string | null;
  childModel: string | null;
  spawnedAt: string | null;
};

export type SessionCatalog = {
  catalog: Record<string, unknown> | null;
  parents: SessionEdge[];
  children: SessionEdge[];
  commitLinks: Record<string, unknown>[];
  truncated: boolean;
};

function edge(value: Record<string, unknown>): SessionEdge | null {
  const parent = text(value.parentSessionId);
  const child = text(value.childSessionId);
  return parent && child
    ? {
        parentSessionId: parent,
        childSessionId: child,
        relationship: text(value.relationship),
        childAgentType: text(value.childAgentType),
        childAgentName: text(value.childAgentName),
        childModel: text(value.childModel),
        spawnedAt: text(value.spawnedAt),
      }
    : null;
}

export async function sessionCatalog(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
): Promise<SessionCatalog> {
  const body = z
    .object({
      catalog: record.nullable(),
      parents: z.array(record),
      children: z.array(record),
      commitLinks: z.array(record).default([]),
      truncated: z.boolean().default(false),
    })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "catalog")}${query({ source: session.source })}`,
        signal,
      ),
    );
  return {
    catalog: body.catalog,
    parents: body.parents.map(edge).filter((row): row is SessionEdge => !!row),
    children: body.children
      .map(edge)
      .filter((row): row is SessionEdge => !!row),
    commitLinks: body.commitLinks,
    truncated: body.truncated,
  };
}
