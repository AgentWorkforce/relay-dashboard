// Session detail: overview (who, where, when, how long), subagent links,
// resume command, and the full transcript, as on the hosted session page.
import { useEffect, useMemo, useRef, useState } from "react";
import { SignedOut } from "../api/client";
import { useLoad } from "./use-load";
import {
  sessionCatalog,
  sessionEvents,
  sessionTiming,
  sessionTurns,
  type SessionCatalog,
  type SessionTiming,
} from "./api";
import {
  dateTime,
  harnessName,
  memberNames,
  promptLabel,
  shortProject,
  type Member,
} from "./data";
import { buildTranscript } from "./model/transcript-cells";
import { mergeReplay, messageRole, resumeCommand } from "./model/replay-model";
import {
  collapseHistoryCopies,
  transcriptCounts,
  withRecordedFileEdits,
} from "./transcript-extras";
import { formatSessionDuration } from "./model/session-timing";
import { backHref, onLinkClick, sessionHref } from "./route";
import { Transcript } from "./Transcript";

type Loaded = {
  events: Record<string, unknown>[];
  turns: Record<string, unknown>[];
  members: Member[];
  nextCursor: string | null;
  timing: SessionTiming | null;
  catalog: SessionCatalog | null;
};

const MAX_TURN_PAGES = 50;
const MAX_CITATION_PAGES = 20;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function SessionView({
  workspaceId,
  sessionId,
  source,
  event,
  from = null,
  onSignedOut,
}: {
  workspaceId: string;
  sessionId: string;
  source: string;
  event: string | null;
  from?: string | null;
  onSignedOut?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  // A load-more failure belongs to the request key it was raised for.
  const [moreFailure, setMoreFailure] = useState<{
    key: string;
    error: Error;
  } | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [appended, setAppended] = useState<{
    key: string;
    events: Record<string, unknown>[];
    nextCursor: string | null;
  } | null>(null);
  const key = JSON.stringify([workspaceId, sessionId, source, event, attempt]);
  useEffect(() => () => moreRequest.current?.abort(), [key]);
  const loaded = useLoad<Loaded>(key, async (signal) => {
    const session = { sessionId, source };
    // Timing, turns, and catalog are enrichments; the transcript still renders without them.
    const optional = <T,>(promise: Promise<T>, fallback: T) =>
      promise.catch((reason) => {
        if (signal.aborted) throw reason;
        return fallback;
      });
    // Turns supply prompts and replies the event stream may lack, so read
    // every page of them (bounded) before rendering.
    const allTurns = async () => {
      const rows: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_TURN_PAGES; page += 1) {
        const next = await sessionTurns(workspaceId, session, signal, cursor);
        rows.push(...next.turns);
        cursor = next.nextCursor;
        if (!cursor) break;
      }
      return rows;
    };
    // A cited event can sit past the first page; keep reading until it loads.
    const eventsThrough = async () => {
      const first = await sessionEvents(workspaceId, session, null, signal);
      const events = [...first.events];
      let nextCursor = first.nextCursor;
      for (
        let page = 1;
        event &&
        nextCursor &&
        page < MAX_CITATION_PAGES &&
        !events.some((row) => String(row.eventId) === event);
        page += 1
      ) {
        const next = await sessionEvents(workspaceId, session, nextCursor, signal);
        events.push(...next.events);
        nextCursor = next.nextCursor;
      }
      return { events, members: first.members, nextCursor };
    };
    const [page, turns, timing, catalog] = await Promise.all([
      eventsThrough(),
      optional(allTurns(), []),
      optional(sessionTiming(workspaceId, session, signal), null),
      optional(sessionCatalog(workspaceId, session, signal), null),
    ]);
    return {
      events: page.events,
      members: page.members,
      nextCursor: page.nextCursor,
      turns,
      timing,
      catalog,
    };
  });
  const extra = appended?.key === key ? appended : null;
  const data = useMemo<Loaded | null>(() => {
    if (!loaded.data) return null;
    if (!extra) return loaded.data;
    return {
      ...loaded.data,
      events: [
        ...new Map(
          [...loaded.data.events, ...extra.events].map((row) => [
            String(row.eventId),
            row,
          ]),
        ).values(),
      ],
      nextCursor: extra.nextCursor,
    };
  }, [loaded.data, extra]);
  const moreError = moreFailure?.key === key ? moreFailure.error : null;
  const error = loaded.error ?? moreError;
  useEffect(() => {
    if (error instanceof SignedOut) onSignedOut?.();
  }, [error, onSignedOut]);

  const replay = useMemo(
    () => (data ? mergeReplay(data.events, data.turns) : []),
    [data],
  );
  const cells = useMemo(
    () =>
      withRecordedFileEdits(
        buildTranscript(collapseHistoryCopies(replay)),
        replay,
      ),
    [replay],
  );
  const counts = useMemo(() => transcriptCounts(cells), [cells]);

  // Citation deep links: scroll to the cited event once the session loads
  // (not again after "Load later events"). A prompt renders as
  // `message-<id>`, a reply as `cell-<id>`, and tool steps as `cell-<id>:<n>`.
  const initial = loaded.data;
  useEffect(() => {
    if (!initial) return;
    const hash = window.location.hash.slice(1);
    const candidates = [
      hash,
      ...(event
        ? [`message-${event}`, `cell-${event}`, `cell-${event}:0`]
        : []),
    ].filter(Boolean);
    const target = candidates
      .map((id) => document.getElementById(id))
      .find(Boolean);
    if (target) {
      target.scrollIntoView?.({ block: "start" });
    } else if (event && !hash.startsWith(`cell-${event}:`)) {
      // Tool activity is collapsed; opening it is driven by the hash. An
      // explicit `cell-<id>:<n>` hash already names the step to open.
      window.location.hash = `cell-${event}:0`;
    }
  }, [initial, event]);

  async function loadMore() {
    if (!data?.nextCursor) return;
    moreRequest.current?.abort();
    const controller = new AbortController();
    moreRequest.current = controller;
    setMore(true);
    setMoreFailure(null);
    try {
      const page = await sessionEvents(
        workspaceId,
        { sessionId, source },
        data.nextCursor,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAppended({
        key,
        events: [...(extra?.events ?? []), ...page.events],
        nextCursor: page.nextCursor,
      });
    } catch (reason) {
      if (!controller.signal.aborted)
        setMoreFailure({ key, error: reason as Error });
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null;
        setMore(false);
      }
    }
  }

  function jumpToNextActivity() {
    const offset =
      (document.querySelector(".session-sticky")?.getBoundingClientRect()
        .bottom ?? 0) + 8;
    const groups = [
      ...document.querySelectorAll<HTMLElement>(".transcript .activity-group"),
    ];
    const next =
      groups.find((group) => group.getBoundingClientRect().top > offset + 1) ??
      groups[0];
    if (!next) return;
    next.scrollIntoView?.({ block: "start", behavior: "smooth" });
    next.querySelector("summary")?.focus();
  }

  async function cite(anchor: string) {
    const url = new URL(window.location.href);
    url.hash = anchor;
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(anchor);
    } catch {
      setCopied(null);
    }
  }

  const catalog = data?.catalog?.catalog ?? null;
  const title =
    promptLabel(catalog?.title, 160) ??
    promptLabel(replay.find((row) => row.taskTitle)?.taskTitle, 160) ??
    cells
      .filter((cell) => cell.kind === "user")
      .map((cell) => promptLabel(cell.kind === "user" ? cell.text : null, 160))
      .find(Boolean) ??
    `Session · ${sessionId.slice(0, 8)}`;
  const owners = [
    ...new Set(
      replay
        .filter((row) => messageRole(row) === "user")
        .map((row) => row.userId)
        .filter((id): id is string => !!id),
    ),
  ];
  const models = [
    ...new Set(
      replay
        .map((row) => row.model)
        .filter((model): model is string => !!model),
    ),
  ];
  const project =
    text(catalog?.repoUrl) ??
    text(catalog?.projectKey) ??
    replay.find((row) => row.projectPath)?.projectPath ??
    null;
  const started = data?.timing?.startedAt ?? replay[0]?.ts ?? null;
  const last = data?.timing?.lastActionAt ?? replay.at(-1)?.ts ?? null;
  const resume = data ? resumeCommand(replay, sessionId) : null;

  return (
    <div className="session-view">
      <div className="session-sticky">
        <a className="back" href={backHref(from)} onClick={onLinkClick}>
          ← Sessions
        </a>
        {data && (
          <>
            <span className="sticky-title" title={title}>
              {title}
            </span>
            {counts.tools > 0 && (
              <button
                type="button"
                className="jump"
                onClick={jumpToNextActivity}
                title="Scroll to the next tool call"
              >
                Next tool call ↓
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="load-error">
          <span>
            {error instanceof SignedOut
              ? "Taking you to sign in…"
              : error.message}
          </span>
          {!(error instanceof SignedOut) && (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!data && !error && <p role="status">Loading session…</p>}
      {data && (
        <>
          <div className="session-heading">
            <h1>{title}</h1>
            <p title={project ?? undefined}>
              {[
                harnessName(source),
                project ? shortProject(project) : null,
                text(catalog?.gitBranch),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <dl className="overview">
            <div>
              <dt>People</dt>
              <dd>
                {owners.length
                  ? memberNames(owners, data.members).join(", ")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{dateTime(started)}</dd>
            </div>
            <div>
              <dt>Last action</dt>
              <dd>{dateTime(last)}</dd>
            </div>
            <div>
              <dt>Working</dt>
              <dd title="Recorded work intervals">
                {formatSessionDuration(data.timing?.workMs ?? null)}
              </dd>
            </div>
            <div>
              <dt>Waiting</dt>
              <dd title="Recorded waiting intervals">
                {formatSessionDuration(data.timing?.waitingMs ?? null)}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd title="First to last recorded activity">
                {formatSessionDuration(
                  started && last
                    ? Date.parse(last) - Date.parse(started)
                    : null,
                )}
              </dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>
                {data.events.length}
                {data.nextCursor ? "+" : ""}
              </dd>
            </div>
            <div>
              <dt>Prompts · tool calls</dt>
              <dd>
                {counts.prompts} · {counts.tools}
              </dd>
            </div>
            {models.length > 0 && (
              <div>
                <dt>Model</dt>
                <dd>{models.join(", ")}</dd>
              </div>
            )}
          </dl>
          {data.catalog?.parents.length || data.catalog?.children.length ? (
            <section className="subagents" aria-label="Related sessions">
              {data.catalog.parents.map((edge) => (
                <a
                  key={`p:${edge.parentSessionId}`}
                  href={sessionHref(edge.parentSessionId, source)}
                  onClick={onLinkClick}
                >
                  ↑ Parent session
                </a>
              ))}
              {data.catalog.children.length > 0 && (
                <>
                  <h2>Subagents</h2>
                  <ul>
                    {data.catalog.children.map((edge) => (
                      <li key={`c:${edge.childSessionId}`}>
                        <a
                          href={sessionHref(edge.childSessionId, source)}
                          onClick={onLinkClick}
                        >
                          {edge.childAgentName ||
                            edge.childAgentType ||
                            "Subagent"}
                        </a>
                        <span className="dim">
                          {[
                            edge.childAgentName &&
                            edge.childAgentType !== edge.childAgentName
                              ? edge.childAgentType
                              : null,
                            edge.childModel,
                            edge.spawnedAt ? dateTime(edge.spawnedAt) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : null}
          {resume && (
            <div className="resume">
              <code>{resume}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(resume)}
              >
                Copy resume command
              </button>
            </div>
          )}
          {copied && (
            <p role="status" className="dim small">
              Link copied
            </p>
          )}
          <Transcript
            cells={cells}
            events={replay}
            members={data.members}
            source={source}
            onCite={(anchor) => void cite(anchor)}
          />
          {data.nextCursor && (
            <button
              className="more"
              type="button"
              onClick={() => void loadMore()}
              disabled={more}
            >
              {more ? "Loading…" : "Load later events"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
