// Session detail: overview (who, where, when, how long), subagent links,
// resume command, and the full transcript, as on the hosted session page.
import { useEffect, useMemo, useState } from "react";
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

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function SessionView({
  workspaceId,
  sessionId,
  source,
  event,
  from = null,
}: {
  workspaceId: string;
  sessionId: string;
  source: string;
  event: string | null;
  from?: string | null;
}) {
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState<Error | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [appended, setAppended] = useState<{
    key: string;
    events: Record<string, unknown>[];
    nextCursor: string | null;
  } | null>(null);
  const key = JSON.stringify([workspaceId, sessionId, source, attempt]);
  const loaded = useLoad<Loaded>(key, async (signal) => {
    const session = { sessionId, source };
    // Timing, turns, and catalog are enrichments; the transcript still renders without them.
    const optional = <T,>(promise: Promise<T>, fallback: T) =>
      promise.catch((reason) => {
        if (signal.aborted) throw reason;
        return fallback;
      });
    const [page, turns, timing, catalog] = await Promise.all([
      sessionEvents(workspaceId, session, null, signal),
      optional(sessionTurns(workspaceId, session, signal), {
        turns: [],
        nextCursor: null,
      }),
      optional(sessionTiming(workspaceId, session, signal), null),
      optional(sessionCatalog(workspaceId, session, signal), null),
    ]);
    return {
      events: page.events,
      members: page.members,
      nextCursor: page.nextCursor,
      turns: turns.turns,
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
  const error = loaded.error ?? moreError;

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

  // Citation deep links: scroll to the cited event once the transcript renders.
  useEffect(() => {
    if (!data) return;
    const anchor =
      window.location.hash.slice(1) || (event ? `message-${event}` : "");
    if (!anchor) return;
    const target =
      document.getElementById(anchor) ??
      (event ? document.getElementById(`cell-${event}:0`) : null);
    if (target) {
      target.scrollIntoView?.({ block: "start" });
    } else if (event) {
      // Tool activity is collapsed; opening it is driven by the hash.
      window.location.hash = `cell-${event}:0`;
    }
  }, [data, event]);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setMore(true);
    setMoreError(null);
    try {
      const page = await sessionEvents(
        workspaceId,
        { sessionId, source },
        data.nextCursor,
        new AbortController().signal,
      );
      setAppended({
        key,
        events: [...(extra?.events ?? []), ...page.events],
        nextCursor: page.nextCursor,
      });
    } catch (reason) {
      setMoreError(reason as Error);
    } finally {
      setMore(false);
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
          <span>{error.message}</span>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
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
