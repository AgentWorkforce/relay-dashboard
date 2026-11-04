// Session detail: overview (who, where, when, how long), subagent links,
// resume command, and the full transcript, as on the hosted session page.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  GitBranch,
  MessageSquare,
  PanelRight,
  Play,
} from "lucide-react";
import { Button, buttonClass, Skeleton } from "../shell/ui";
import styles from "./sessions.module.css";
import { WorkspaceViewSlot } from "../shell/view-slots";
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
  toolKey,
  type Member,
} from "./data";
import { buildTranscript } from "./model/transcript-cells";
import {
  mergeReplay,
  messageRole,
  replayTurnAliases,
  resumeCommand,
} from "./model/replay-model";
import {
  collapseHistoryCopies,
  historyCopyTargets,
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
  // Hosted keeps the session overview behind the Details toggle.
  const [showDetails, setShowDetails] = useState(false);
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
    // mergeReplayStreams renders a message under its turn id when a turn
    // replaces the event; follow the same pairing to the turn's anchor.
    const alias = event
      ? replayTurnAliases(initial.events, initial.turns).get(event)
      : undefined;
    // A cited raw history copy is collapsed into the projected record that
    // survives; follow it there (and to that record's turn, if any).
    const survivor = event
      ? historyCopyTargets(mergeReplay(initial.events, initial.turns)).get(
          alias ?? event,
        )
      : undefined;
    const ids = [event, alias, survivor].filter(
      (id): id is string => !!id,
    );
    const candidates = [
      hash,
      ...ids.flatMap((id) => [`message-${id}`, `cell-${id}`, `cell-${id}:0`]),
    ].filter(Boolean);
    const target = candidates
      .map((id) => document.getElementById(id))
      .find(Boolean);
    // Context and image cells keep their content in a closed disclosure,
    // which opens when the hash names it.
    const closed = target?.querySelector(":scope > details:not([open])");
    if (target && closed && !hash) {
      window.location.hash = target.id;
    } else if (target) {
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

  const overviewList = data && (
    <dl className="overview">
      <div>
        <dt>People</dt>
        <dd>
          {owners.length ? memberNames(owners, data.members).join(", ") : "—"}
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
            started && last ? Date.parse(last) - Date.parse(started) : null,
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
        <dt>Prompts · tool steps</dt>
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
  );
  return (
    <div className="session-view mx-auto flex w-full max-w-[1440px] flex-col">
      <WorkspaceViewSlot name="heading">
        <div className={styles.heading}>
          <h1>Session</h1>
        </div>
      </WorkspaceViewSlot>
      <WorkspaceViewSlot name="toolbar">
        <a
          className={`back ${buttonClass("ghost", "sm")}`}
          data-slot="button"
          href={backHref(from)}
          onClick={onLinkClick}
        >
          <ArrowLeft aria-hidden="true" />
          Sessions
        </a>
        {data && counts.tools > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="jump"
            onClick={jumpToNextActivity}
            title="Scroll to the next tool call"
          >
            Next tool call
            <ArrowDown aria-hidden="true" />
          </Button>
        )}
      </WorkspaceViewSlot>
      {error && (
        <div role="alert" className="load-error px-5 md:px-9">
          <span>
            {error instanceof SignedOut
              ? "Taking you to sign in…"
              : error.message}
          </span>
          {!(error instanceof SignedOut) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {!data && !error && (
        <div role="status" aria-label="Loading session…" className="flex flex-col gap-4 px-5 py-4 md:px-9">
          <span className="sr-only">Loading session…</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-40 w-full max-w-[760px]" />
        </div>
      )}
      {data && (
        <>
          <header
            id="session-start"
            tabIndex={-1}
            className="session-heading flex shrink-0 scroll-mt-24 flex-col gap-4 border-b border-border px-5 py-4 md:px-9"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {(project || text(catalog?.gitBranch)) && (
                  <p
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                    title={project ?? undefined}
                  >
                    {project && (
                      <span className="max-w-full break-words">
                        {shortProject(project)}
                      </span>
                    )}
                    {project && text(catalog?.gitBranch) && (
                      <span aria-hidden="true">/</span>
                    )}
                    {text(catalog?.gitBranch) && (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="break-all font-mono">
                          {text(catalog?.gitBranch)}
                        </span>
                      </span>
                    )}
                  </p>
                )}
                <h1
                  className="line-clamp-2 min-w-0 max-w-full text-xl font-semibold leading-8 tracking-tight"
                  title={title}
                >
                  {title}
                </h1>
                <p
                  aria-label="Session identity"
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"
                >
                  <span className="flex shrink-0 items-center gap-2">
                    <HarnessMark source={source} />
                    {harnessName(source)}
                  </span>
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showDetails}
                  aria-controls="session-details"
                  onClick={() => setShowDetails((value) => !value)}
                >
                  <PanelRight aria-hidden="true" />
                  Details
                </Button>
                {resume && <CopyResumeCommand command={resume} />}
              </div>
            </div>
          </header>
          <div className="flex min-w-0 flex-col xl:flex-row">
            <aside
              id="session-details"
              hidden={!showDetails}
              aria-label="Session overview"
              className={`min-w-0 flex-col gap-5 border-b border-border px-5 py-5 xl:sticky xl:top-0 xl:order-last xl:w-[288px] xl:shrink-0 xl:self-start xl:border-b-0 xl:border-l ${showDetails ? "flex" : "hidden"}`}
            >
              <h2 className="text-xs font-medium text-muted-foreground">
                Session overview
              </h2>
              {overviewList}
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
            </aside>
            <section
              aria-label="Conversation"
              data-session-messages
              className="min-w-0 flex-1 px-5 py-5 md:px-9"
            >
              {copied && (
                <p role="status" className="dim small mb-4">
                  Link copied
                </p>
              )}
              {replay.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <MessageSquare
                    className="size-7 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h3 className="font-medium">No conversation recorded yet</h3>
                  <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                    Messages will appear here once this session syncs from your
                    computer.
                  </p>
                </div>
              )}
              <div className="mx-auto max-w-[760px] pb-4">
                <Transcript
                  cells={cells}
                  events={replay}
                  members={data.members}
                  source={source}
                  onCite={(anchor) => void cite(anchor)}
                />
                {data.nextCursor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="more"
                    onClick={() => void loadMore()}
                    disabled={more}
                  >
                    {more ? "Loading…" : "Load later events"}
                  </Button>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** Hosted copy-resume-command.tsx. */
function CopyResumeCommand({ command }: { command: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="flex max-w-xs flex-col items-start gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label="Resume session: copy terminal command"
        title="Copy resume command. Paste it in a terminal on the original computer."
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setStatus("Copied resume command");
          } catch {
            setStatus(
              "Could not copy. Select the command below to copy it manually.",
            );
          }
        }}
      >
        <Play aria-hidden="true" />
        Resume
      </Button>
      <span role="status" className="text-xs text-muted-foreground empty:hidden">
        {status}
      </span>
      {status.startsWith("Could not") ? (
        <code className="w-full select-all whitespace-pre-wrap break-all text-xs">
          {command}
        </code>
      ) : null}
    </div>
  );
}

/** Hosted session identity row: the harness's onboarding icon. */
function HarnessMark({ source }: { source: string }) {
  const key = toolKey(source);
  return KNOWN_ICONS.has(key) ? (
    <img
      src={`${import.meta.env.BASE_URL}onboarding-icons/${key}.svg`}
      className="size-4"
      alt=""
    />
  ) : null;
}
const KNOWN_ICONS = new Set([
  "claude",
  "codex",
  "devin",
  "gemini",
  "cursor",
  "opencode",
  "grok",
  "muse",
  "capy",
  "chatgpt",
  "mcp",
]);
