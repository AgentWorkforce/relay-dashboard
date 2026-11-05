import { read, SignedOut } from "../../api/client";
import { listSessions, sessionEvents, sessionTurns } from "../api";
import { isRecord, mergeReplay, toReplayEvent, toReplayTurn, type ReplayEvent, type ReplayState } from "../model/replay-model";
import { graphRow } from "./session-data";
import type { SessionGraphEvidence } from "./session-graph-data";

export { SignedOut as SessionsAuthorizationError };
type Identity = { source: string; sessionId: string };
export type SessionGraphDetail = { catalog: unknown | null; replay: ReplayState | null; catalogError: boolean; pullRequests: NonNullable<SessionGraphEvidence["pullRequests"]> };

export async function fetchSessionPage(_account: string, workspace: string, q: string, cursor: string, _fresh: boolean, signal: AbortSignal) {
  const page = await listSessions(workspace, { q: q || undefined }, cursor || null, signal);
  return { ...page, items: page.items.map(graphRow), error: false };
}

/** relaycontrol checks membership, attests History scope and verifies this natural identity. */
export async function readGraphCatalog(workspaceId: string, identity: Identity, signal: AbortSignal) {
  const body: unknown = await read(`/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(identity.sessionId)}/catalog?${new URLSearchParams({ source: identity.source })}`, signal);
  if (!isRecord(body) || body.sessionId !== identity.sessionId || body.source !== identity.source || body.workspaceId !== workspaceId || typeof body.found !== "boolean" || !Array.isArray(body.parents) || !Array.isArray(body.children)) throw new Error("Catalog is temporarily unavailable.");
  return body.found ? body : null;
}

function normalize(rows: Record<string, unknown>[], identity: Identity): ReplayEvent[] {
  return rows.filter((row) => !row.source || row.source === identity.source)
    .map((row) => toReplayEvent({ ...row, source: identity.source })).filter((row): row is ReplayEvent => row !== null);
}

/** Independent event/turn cursors, bounded pages, exact source and loop detection. */
export async function readGraphReplay(workspace: string, identity: Identity, signal: AbortSignal, maxPages: number): Promise<ReplayState> {
  const events = new Map<string, Record<string, unknown>>();
  const turns = new Map<string, Record<string, unknown>>();
  let nextCursor: string | null = null, turnsNextCursor: string | null = null;
  let eventsDone = false, turnsDone = false, failed = false;
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const pages: [PromiseSettledResult<Awaited<ReturnType<typeof sessionEvents>> | null>, PromiseSettledResult<Awaited<ReturnType<typeof sessionTurns>> | null>] = await Promise.allSettled([
      eventsDone ? Promise.resolve(null) : sessionEvents(workspace, identity, nextCursor, signal),
      turnsDone ? Promise.resolve(null) : sessionTurns(workspace, identity, signal, turnsNextCursor),
    ]);
    const [eventPage, turnPage] = pages;
    for (const result of [eventPage, turnPage]) if (result.status === "rejected" && result.reason instanceof SignedOut) throw result.reason;
    if (eventPage.status === "fulfilled" && eventPage.value) {
      for (const row of eventPage.value.events) events.set(String(row.eventId), row);
      nextCursor = eventPage.value.nextCursor;
      eventsDone = !nextCursor;
    } else if (eventPage.status === "rejected") { failed = true; eventsDone = true; }
    if (turnPage.status === "fulfilled" && turnPage.value) {
      for (const row of turnPage.value.turns) turns.set(String(row.id), row);
      turnsNextCursor = turnPage.value.nextCursor;
      turnsDone = !turnsNextCursor;
    } else if (turnPage.status === "rejected") { failed = true; turnsDone = true; }
    if (eventsDone && turnsDone) break;
    const cursor = JSON.stringify([nextCursor, turnsNextCursor]);
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  const rawEvents = [...events.values()], rawTurns = [...turns.values()];
  const scopedEvents = rawEvents.filter((row) => !row.source || row.source === identity.source).map((row) => ({ ...row, source: identity.source }));
  const scopedTurns = rawTurns.flatMap((row) => {
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    if ([row.source, metadata.source, metadata.nativeCli].some((source) => typeof source === "string" && source && source !== identity.source)) return [];
    return [{ ...row, source: identity.source, metadata: { ...metadata, source: identity.source, nativeCli: identity.source } }];
  });
  return { source: identity.source, events: mergeReplay(scopedEvents, scopedTurns), streams: { events: normalize(rawEvents, identity), turns: scopedTurns.map(toReplayTurn).filter((row): row is ReplayEvent => row !== null) }, nextCursor, turnsNextCursor, error: failed ? "Some recorded activity is unavailable." : null };
}

async function detail(workspace: string, identity: Identity, pages: number): Promise<SessionGraphDetail> {
  const signal = AbortSignal.timeout(15_000);
  const [catalog, replay] = await Promise.allSettled([readGraphCatalog(workspace, identity, signal), readGraphReplay(workspace, identity, signal, pages)]);
  for (const result of [catalog, replay]) if (result.status === "rejected" && result.reason instanceof SignedOut) throw result.reason;
  return { catalog: catalog.status === "fulfilled" ? catalog.value : null, replay: replay.status === "fulfilled" ? replay.value : null, catalogError: catalog.status === "rejected" || catalog.value === null, pullRequests: [] };
}

export async function loadGraphDetail(workspace: string, source: string, sessionId: string) {
  return detail(workspace, { source, sessionId }, 1);
}
export async function loadGraphRelationships(workspace: string, identities: Identity[]) {
  if (identities.length > 20) throw new Error("Too many sessions.");
  const evidence: SessionGraphEvidence[] = [], failed: Identity[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, identities.length) }, async () => {
    while (next < identities.length) {
      const identity = identities[next++]!;
      const result = await detail(workspace, identity, 10);
      if (result.catalogError && (!result.replay || (result.replay.error && result.replay.events.length === 0))) failed.push(identity);
      else evidence.push({ ...identity, catalog: result.catalog, replay: result.replay, pullRequests: result.pullRequests });
    }
  }));
  return { evidence, failed };
}
