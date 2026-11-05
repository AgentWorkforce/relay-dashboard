// Ported from Cloud session visualizations, head55bfc58fb.
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bot, ChevronDown, CircleAlert, Clock3, FilePenLine, FileText,
  FlaskConical, GitCommitHorizontal, GitPullRequest, Globe, ListChecks,
  MessagesSquare, Package, Pause, Play, RotateCcw, Search, Send,
  ShieldCheck, Terminal, Upload, UserRound, X,
} from "lucide-react";
import { type SessionMember } from "./session-data";
import { Avatar, AvatarImage, AvatarFallback } from "./avatar";
import { Button } from "../../shell/ui";
import { isCodexReviewMessage } from "./session-auto-review";
import type { ReplayEvent } from "../model/replay-model";
import { buildTraceReplayLegs } from "./trace-replay";
import {
  buildTraceWaterfall,
  type TraceExchange,
  type TraceStep,
  type TraceWaterfallData,
} from "./trace-waterfall-model";
import type { TranscriptCell } from "../model/transcript-cells";
import { formatSessionDuration } from "../model/session-timing";
import { HarnessIcon as DashboardHarnessIcon } from "../harness-icon";
import styles from "./trace-waterfall.module.css";

const REPLAY_MS = 12_000;
type Row = {
  id: string;
  level: number;
  exchange?: TraceExchange;
  step?: TraceStep;
};

function percent(at: number, start: number, end: number) {
  return end > start
    ? Math.max(0, Math.min(100, ((at - start) / (end - start)) * 100))
    : 0;
}

function timestamp(at: number) {
  return new Date(at).toLocaleString();
}

function kindName(step: TraceStep) {
  return step.kind === "tool"
    ? "Tool"
    : step.kind === "reply"
      ? "Response"
      : "Request";
}

export function HarnessIcon({ source }: { source?: string }) {
  return <DashboardHarnessIcon source={source ?? ""} className={styles.harnessIcon} />;
}

type RequestAuthorProps = { event?: ReplayEvent; owners: SessionMember[]; source?: string; autoReview?: boolean };

function requestOwner(event: ReplayEvent | undefined, owners: SessionMember[]) {
  return event?.actorRole !== "steerer"
    ? event?.userId ? owners.find((candidate) => candidate.id === event.userId) : owners.length === 1 ? owners[0] : undefined
    : undefined;
}

export function requestAuthorName({ event, owners, source, autoReview }: RequestAuthorProps) {
  if (isCodexReviewMessage(event, source ?? "", autoReview)) return "Codex";
  if (/^<ci-monitor-event(?:\s|>)/i.test(event?.content?.trim() ?? "")) return "Automated PR feedback";
  return requestOwner(event, owners)?.name || event?.actorName || "User";
}

export function RequestAvatar({ event, owners, source, autoReview }: RequestAuthorProps) {
  if (isCodexReviewMessage(event, source ?? "", autoReview)) return <HarnessIcon source="codex" />;
  if (/^<ci-monitor-event(?:\s|>)/i.test(event?.content?.trim() ?? "")) return <GitPullRequest size={15} aria-label="Automated PR feedback" role="img" className={styles.actionIcon} />;
  const owner = requestOwner(event, owners);
  const name = requestAuthorName({ event, owners, source, autoReview });
  return <Avatar key={owner?.avatarUrl ?? name} className={styles.userAvatar} title={name} aria-label={name}>
    {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} alt={name} />}
    <AvatarFallback><UserRound size={12} aria-hidden="true" /></AvatarFallback>
  </Avatar>;
}

export function StepIcon({ step, source, event, owners = [], autoReview }: { step: TraceStep; source?: string; event?: ReplayEvent; owners?: SessionMember[]; autoReview?: boolean }) {
  if (step.kind === "prompt") return <RequestAvatar event={event} owners={owners} source={source} autoReview={autoReview} />;
  if (!step.failed && step.kind === "reply") return <HarnessIcon source={step.source || source} />;
  const label = step.label;
  const Icon = step.failed ? CircleAlert
    : /pull request|PR #/i.test(label) ? GitPullRequest
    : /Wait|Pause/.test(label) ? Clock3
    : /Search/.test(label) ? Search
    : /Edit/.test(label) ? FilePenLine
    : /Read|Inspect project/.test(label) ? FileText
    : /Run tests/.test(label) ? FlaskConical
    : /Check|plan/.test(label) ? ListChecks
    : /Build|Install/.test(label) ? Package
    : /web|GitHub/.test(label) ? Globe
    : /Delegate/.test(label) ? Bot
    : /Send/.test(label) ? Send
    : /Push/.test(label) ? Upload
    : /Commit/.test(label) ? GitCommitHorizontal
    : /Review|Allow|Block/.test(label) ? ShieldCheck
    : Terminal;
  return <Icon size={14} aria-hidden="true" className={`${styles.actionIcon} ${styles[step.failed ? "failed" : step.kind]}`} />;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

function TimelineBar({
  start,
  end,
  axisStart,
  axisEnd,
  kind,
  failed = false,
  preview = false,
  revealAt,
  playing = false,
}: {
  start: number;
  end: number | null;
  axisStart: number;
  axisEnd: number;
  kind: "agent" | "prompt" | "reply" | "tool";
  failed?: boolean;
  preview?: boolean;
  revealAt: number;
  playing?: boolean;
}) {
  const left = percent(start, axisStart, axisEnd);
  const duration = end === null ? null : Math.max(0, end - start);
  const active = playing && end !== null && start <= revealAt && end > revealAt;
  const width =
    duration !== null && axisEnd > axisStart
      ? Math.max(
          0.7,
          percent(Math.min(end!, revealAt), axisStart, axisEnd) - left,
        )
      : 0;
  return (
    <span
      aria-hidden="true"
      className={`${styles.timelineMark} ${duration === null || duration === 0 ? styles.instant : styles.interval} ${styles[kind]} ${failed ? styles.failed : ""} ${preview ? styles.previewMark : ""} ${active ? styles.activeMark : ""}`}
      style={{
        left: `${left}%`,
        width: duration === null || duration === 0 ? undefined : `${width}%`,
        visibility: start > revealAt ? "hidden" : "visible",
      }}
    />
  );
}

type TraceWaterfallProps = {
  events: ReplayEvent[];
  transcript?: TranscriptCell[];
  partial: boolean;
  historyLoading?: boolean;
  onOpenTranscript: (anchor: string) => void;
  source?: string;
  title?: string;
  owners?: SessionMember[];
  autoReview?: boolean;
};

export function TraceWaterfall(props: TraceWaterfallProps) {
  const data = useMemo(
    () => buildTraceWaterfall(props.events, props.transcript),
    [props.events, props.transcript],
  );
  // Older history changes the origin; appended activity must not restart replay.
  const traceKey = `${data.start}:${data.exchanges[0]?.id}`;
  return <TraceWaterfallView key={traceKey} data={data} {...props} />;
}

function TraceWaterfallView({
  data,
  partial,
  historyLoading = false,
  onOpenTranscript,
  source,
  title,
  events,
  owners = [],
  autoReview,
}: TraceWaterfallProps & { data: TraceWaterfallData }) {
  const eventsById = useMemo(() => new Map(events.map((event) => [event.eventId, event])), [events]);
  // Store only explicit collapses so requests arriving after mount start open too.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const expanded = data.exchanges.filter((exchange) => !collapsed.includes(exchange.id)).map((exchange) => exchange.id);
  const [focused, setFocused] = useState<string | null>(null);
  const [activeId, setActiveId] = useState("trace");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reducedMotion] = useState(prefersReducedMotion);
  const legs = useMemo(() => buildTraceReplayLegs(data, events), [data, events]);
  const [legIndex, setLegIndex] = useState(0);
  const [playback, setPlayback] = useState<"playing" | "paused" | "done" | "waiting">(() =>
    prefersReducedMotion() || data.end <= data.start ? "done" : "playing",
  );
  const [cursor, setCursor] = useState(() =>
    prefersReducedMotion() || data.end <= data.start ? data.end : data.start,
  );
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const dialogClose = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const playbackStart = useRef<number | null>(null);

  const focusedExchange =
    data.exchanges.find((exchange) => exchange.id === focused) ?? null;
  const leg = legs[legIndex];
  const visibleExchanges = reducedMotion ? data.exchanges : data.exchanges.slice(0, (leg?.lastExchange ?? 0) + 1);
  const exchanges = focusedExchange ? visibleExchanges.filter((exchange) => exchange.id === focusedExchange.id) : visibleExchanges;
  // Keep a single recorded-time axis throughout replay and focus changes.
  const axisStart = data.start;
  const axisEnd = data.end;
  const span = Math.max(0, axisEnd - axisStart);
  const revealAt = reducedMotion ? axisEnd : cursor;
  const progress = span > 0 ? Math.max(0, Math.min(1, (revealAt - axisStart) / span)) : 1;
  const nextLeg = legs[legIndex + 1];
  const hasContinuation = !reducedMotion && (playback === "done" || playback === "waiting") && (nextLeg !== undefined || (leg !== undefined && leg.end > cursor));
  const playLabel = playback === "playing" ? "Pause replay" : hasContinuation ? "Play next request" : "Play replay";
  const steps = data.exchanges.flatMap((exchange) => exchange.steps);
  const tools = steps.filter((step) => step.kind === "tool");
  const errors = tools.filter((step) => step.failed).length;
  const rows: Row[] = [{ id: "trace", level: 1 }];
  for (const exchange of exchanges) {
    if (exchange.start <= revealAt)
      rows.push({ id: `exchange:${exchange.id}`, level: 2, exchange });
    if (expanded.includes(exchange.id)) {
      for (const step of exchange.steps)
        if (step.at <= revealAt)
          rows.push({ id: `step:${step.id}`, level: 3, exchange, step });
    }
  }

  useEffect(() => {
    // Older pages move the trace origin. Start playback once it is known so paging
    // cannot repeatedly restart the animation or skip the earliest requests.
    if (historyLoading || playback !== "playing" || reducedMotion || !leg) return;
    let frame = 0;
    const from = Math.max(cursor, leg.start);
    const remaining = Math.max(0, leg.end - from);
    const duration = REPLAY_MS * remaining / Math.max(1, leg.end - leg.start);
    const tick = (now: number) => {
      if (playbackStart.current === null)
        playbackStart.current = now;
      const next = duration > 0 ? Math.min(1, (now - playbackStart.current) / duration) : 1;
      setCursor(from + remaining * next);
      if (next >= 1) {
        playbackStart.current = null;
        setPlayback(nextLeg ? "waiting" : "done");
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); playbackStart.current = null; };
    // The frame owns cursor updates; resume captures the current recorded instant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoading, playback, reducedMotion, leg?.start, leg?.end, legIndex]);

  function play() {
    if (reducedMotion) return;
    playbackStart.current = null;
    if (hasContinuation) {
      if (nextLeg && (!leg || cursor >= leg.end)) {
        setLegIndex(legIndex + 1);
        setCursor(nextLeg.start);
        const nextIds = new Set(data.exchanges.slice((leg?.lastExchange ?? -1) + 1, nextLeg.lastExchange + 1).map((exchange) => exchange.id));
        setCollapsed((current) => current.filter((id) => !nextIds.has(id)));
      }
      setFocused(null);
      setSelectedId(null);
      setActiveId("trace");
    } else if (playback === "done") {
      setLegIndex(0);
      setCursor(data.start);
      setFocused(null);
      setSelectedId(null);
      setActiveId("trace");
    }
    setPlayback(playback === "playing" ? "paused" : "playing");
  }

  useEffect(() => {
    if (!selectedId) return;
    dialogClose.current?.focus();
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedId(null);
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      lastTrigger.current?.focus();
    };
  }, [selectedId]);

  function toggle(id: string) {
    if (expanded.includes(id) && activeId.startsWith("step:")) {
      const owner = exchanges.find(
        (exchange) =>
          exchange.id === id &&
          exchange.steps.some((step) => `step:${step.id}` === activeId),
      );
      if (owner) {
        const branchId = `exchange:${id}`;
        setActiveId(branchId);
        rowRefs.current.get(branchId)?.focus();
      }
    }
    setCollapsed((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function select(id: string, trigger?: HTMLButtonElement | null) {
    lastTrigger.current = trigger ?? rowRefs.current.get(id) ?? null;
    setSelectedId(id);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, row: Row) {
    const index = rows.findIndex((item) => item.id === row.id);
    let next: Row | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = rows[index + 1];
        break;
      case "ArrowUp":
        next = rows[index - 1];
        break;
      case "Home":
        next = rows[0];
        break;
      case "End":
        next = rows.at(-1);
        break;
      case "ArrowRight":
        if (row.exchange && !row.step && !expanded.includes(row.exchange.id))
          toggle(row.exchange.id);
        else if (row.exchange && !row.step) next = rows[index + 1];
        break;
      case "ArrowLeft":
        if (row.exchange && !row.step && expanded.includes(row.exchange.id))
          toggle(row.exchange.id);
        else if (row.step && row.exchange)
          next = rows.find(
            (item) => item.id === `exchange:${row.exchange!.id}`,
          );
        else if (row.exchange) next = rows[0];
        break;
      case "Enter":
      case " ":
        select(row.id, event.currentTarget);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next) {
      setActiveId(next.id);
      rowRefs.current.get(next.id)?.focus();
    }
  }

  const selected =
    rows.find((row) => row.id === selectedId) ??
    (selectedId
      ? data.exchanges
          .flatMap((exchange) =>
            exchange.steps.map((step) => ({
              id: `step:${step.id}`,
              level: 3,
              exchange,
              step,
            })),
          )
          .find((row) => row.id === selectedId)
      : null);
  const selectedExchange = selected?.exchange;
  const selectedStep = selected?.step;
  const selectedTitle =
    selectedStep?.label ?? selectedExchange?.label ?? title ?? "Recorded trace";
  const selectedAt = selectedStep?.at ?? selectedExchange?.start ?? data.start;
  const selectedEnd = selectedStep?.end ?? selectedExchange?.end ?? data.end;

  if (!data.exchanges.length)
    return (
      <section aria-label="Trace" className={styles.empty}>
        <span>Trace</span>
        <p>No recorded steps yet.</p>
      </section>
    );

  return (
    <section aria-label="Trace" className={styles.root}>
      <header className={styles.header}>
        {/* Recorded measures only; the page header already names the session and harness. */}
        <dl className={styles.stats} aria-label="Trace statistics">
          {[
            ["Duration", span > 0 ? formatSessionDuration(span) : "0s"],
            [data.exchanges.length === 1 ? "Request" : "Requests", String(data.exchanges.length)],
            ["Tool calls", String(tools.length)],
            ...(errors ? [[errors === 1 ? "Error" : "Errors", String(errors)]] : []),
          ].map(([label, value]) => (
            <div key={label} className={styles.stat} data-tone={/^Error/.test(label!) ? "danger" : undefined}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.headerRight}>
          <span
            className={`${styles.badge} ${!historyLoading && playback === "playing" ? styles.replaying : ""}`}
          >
            {historyLoading ? "Loading history" : hasContinuation || playback === "waiting"
              ? "Waiting"
              : playback === "done"
              ? "Recorded"
              : playback === "playing"
                ? "Replay"
                : "Replay paused"}
          </span>
          <div className={styles.controls} aria-label="Replay controls">
            <button
              type="button"
              aria-label={playLabel}
              title={playLabel}
              onClick={play}
              disabled={historyLoading}
            >
              {playback === "playing" ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              aria-label="Reset replay"
              title="Reset replay"
              disabled={historyLoading}
              onClick={() => {
                playbackStart.current = null;
                setSelectedId(null);
                setFocused(null);
                setActiveId("trace");
                setLegIndex(0);
                setCursor(reducedMotion ? data.end : data.start);
                setPlayback(reducedMotion ? "done" : "paused");
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {hasContinuation && (
        <div className={styles.replayHandoff} role="status">
          <span><strong>Waiting for the next request</strong><span title={nextLeg?.label ?? leg?.label}>{nextLeg?.label ?? leg?.label}</span></span>
          <Button type="button" size="sm" onClick={play}><Play data-icon="inline-start" aria-hidden="true" />Play next request</Button>
        </div>
      )}

      {(partial || data.omittedExchanges > 0 || data.omittedSteps > 0) && (
        <p className={styles.note}>
          {partial ? "Loaded history may omit earlier activity." : ""}
          {data.omittedExchanges > 0 || data.omittedSteps > 0
            ? ` Showing recent activity; ${data.omittedExchanges + data.omittedSteps} earlier rows are in the conversation.`
            : ""}
        </p>
      )}

      <div className={styles.timelineHead} aria-hidden="true">
        <span className={styles.nameHead}>Activity</span>
        <div className={styles.axis}>
          <span>0</span>
          <span>{span ? formatSessionDuration(span / 4) : ""}</span>
          <span>{span ? formatSessionDuration(span / 2) : ""}</span>
          <span>{span ? formatSessionDuration(span * 0.75) : ""}</span>
          <span>{span ? formatSessionDuration(span) : ""}</span>
        </div>
      </div>

      <div className={styles.treeViewport}>
        <div
          role="tree"
          aria-label="Recorded trace events"
          className={styles.tree}
        >
          <div className={`${styles.row} ${styles.rootRow}`}>
            <button
              type="button"
              role="treeitem"
              aria-level={1}
              aria-selected={selectedId === "trace"}
              tabIndex={activeId === "trace" ? 0 : -1}
              ref={(node) => {
                if (node) rowRefs.current.set("trace", node);
                else rowRefs.current.delete("trace");
              }}
              className={styles.rowButton}
              onFocus={() => setActiveId("trace")}
              onKeyDown={(event) => keyDown(event, rows[0]!)}
              onClick={(event) => select("trace", event.currentTarget)}
            >
              <span className={styles.label}>
                <HarnessIcon source={source} />
                <span className={styles.labelText}>Session</span>
                <span className={styles.subtle}>
                  {exchanges.length}{" "}
                  {exchanges.length === 1 ? "request" : "requests"}
                </span>
              </span>
              <span className={styles.rail}>
                <TimelineBar
                  start={axisStart}
                  end={axisEnd}
                  axisStart={axisStart}
                  axisEnd={axisEnd}
                  kind="agent"
                  revealAt={revealAt}
                  playing={playback === "playing"}
                />
                <span className={styles.duration}>
                  {" "}
                  {span ? formatSessionDuration(span) : "point"}
                </span>
              </span>
            </button>
          </div>
          {exchanges
            .filter((exchange) => exchange.start <= revealAt)
            .map((exchange, exchangeIndex) => {
              const open = expanded.includes(exchange.id);
              const row = rows.find(
                (item) => item.id === `exchange:${exchange.id}`,
              )!;
              const exchangeSpan = Math.max(0, exchange.end - exchange.start);
              return (
                <div key={exchange.id} className={styles.branch}>
                  <div
                    className={`${styles.row} ${styles.branchRow}`}
                    style={{
                      animationDelay: `${Math.min(exchangeIndex, 12) * 22}ms`,
                    }}
                  >
                    <button
                      type="button"
                      aria-label={`${open ? "Collapse" : "Expand"} ${exchange.label}`}
                      aria-expanded={open}
                      className={`${styles.fold} ${open ? styles.foldOpen : ""}`}
                      onClick={() => toggle(exchange.id)}
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      role="treeitem"
                      aria-level={2}
                      aria-expanded={open}
                      aria-selected={selectedId === row.id}
                      tabIndex={activeId === row.id ? 0 : -1}
                      ref={(node) => {
                        if (node) rowRefs.current.set(row.id, node);
                        else rowRefs.current.delete(row.id);
                      }}
                      className={styles.rowButton}
                      onFocus={() => setActiveId(row.id)}
                      onKeyDown={(event) => keyDown(event, row)}
                      onClick={(event) => select(row.id, event.currentTarget)}
                    >
                      <span className={styles.label}>
                        <span className={styles.branchLine} />
                        <MessagesSquare size={14} aria-hidden="true" className={styles.actionIcon} />
                        <span
                          className={styles.labelText}
                          title={exchange.label}
                        >
                          {exchange.label}
                        </span>
                        <span className={styles.subtle}>
                          {exchange.steps.length}
                        </span>
                      </span>
                      <span className={styles.rail}>
                        <TimelineBar
                          start={exchange.start}
                          end={exchangeSpan ? exchange.end : null}
                          axisStart={axisStart}
                          axisEnd={axisEnd}
                          kind="agent"
                          revealAt={revealAt}
                          playing={playback === "playing"}
                        />
                        {!open &&
                          exchange.steps.map((step) => (
                            <TimelineBar
                              key={step.id}
                              start={step.at}
                              end={step.end}
                              axisStart={axisStart}
                              axisEnd={axisEnd}
                              kind={step.kind}
                              failed={step.failed}
                              preview
                              revealAt={revealAt}
                              playing={playback === "playing"}
                            />
                          ))}
                        {exchangeSpan > 0 && exchange.end <= revealAt && (
                          <span
                            className={styles.duration}
                            style={{
                              left: `${Math.min(86, percent(exchange.end, axisStart, axisEnd) + 1)}%`,
                            }}
                          >
                            {formatSessionDuration(exchangeSpan)}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                  <div
                    className={`${styles.stepsFold} ${open ? styles.stepsFoldOpen : ""}`}
                    aria-hidden={!open}
                    inert={!open}
                  >
                    <div className={styles.stepsInner}>
                      {exchange.steps
                        .filter((step) => step.at <= revealAt)
                        .map((step, stepIndex) => {
                          const stepRow = rows.find(
                            (item) => item.id === `step:${step.id}`,
                          ) ?? {
                            id: `step:${step.id}`,
                            level: 3,
                            exchange,
                            step,
                          };
                          const duration =
                            step.end === null ? null : step.end - step.at;
                          return (
                            <div
                              key={step.id}
                              className={`${styles.row} ${styles.stepRow}`}
                              style={{
                                animationDelay: `${Math.min(stepIndex, 12) * 18}ms`,
                              }}
                            >
                              <button
                                type="button"
                                role="treeitem"
                                aria-level={3}
                                aria-selected={selectedId === stepRow.id}
                                tabIndex={
                                  open && activeId === stepRow.id ? 0 : -1
                                }
                                ref={(node) => {
                                  if (node)
                                    rowRefs.current.set(stepRow.id, node);
                                  else rowRefs.current.delete(stepRow.id);
                                }}
                                className={styles.rowButton}
                                onFocus={() => setActiveId(stepRow.id)}
                                onKeyDown={(event) => keyDown(event, stepRow)}
                                onClick={(event) =>
                                  select(stepRow.id, event.currentTarget)
                                }
                              >
                                <span className={styles.label}>
                                  <span className={styles.stepLine} />
                                  <StepIcon step={step} source={source} event={eventsById.get(step.id)} owners={owners} autoReview={autoReview} />
                                  <span
                                    className={styles.labelText}
                                    title={step.label}
                                  >
                                    {step.label}
                                  </span>
                                  {step.failed && (
                                    <span className={styles.errorLabel}>
                                      Error
                                    </span>
                                  )}
                                </span>
                                <span className={styles.rail}>
                                  <TimelineBar
                                    start={step.at}
                                    end={step.end}
                                    axisStart={axisStart}
                                    axisEnd={axisEnd}
                                    kind={step.kind}
                                    failed={step.failed}
                                    revealAt={revealAt}
                                    playing={playback === "playing"}
                                  />
                                  {duration !== null &&
                                    step.end! <= revealAt && (
                                      <span
                                        className={styles.duration}
                                        style={{
                                          left: `${Math.min(86, percent(step.end!, axisStart, axisEnd) + 1)}%`,
                                        }}
                                      >
                                        {formatSessionDuration(duration)}
                                      </span>
                                    )}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}
          <div
            className={styles.nowLine}
            aria-hidden="true"
            style={{
              left: `calc(var(--name-width) + (100% - var(--name-width)) * ${progress})`,
            }}
          >
            <span />
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <span>
          <i className={styles.agentKey} />
          Request
        </span>
        <span>
          <i className={styles.replyKey} />
          Response
        </span>
        <span>
          <i className={styles.toolKey} />
          Tool
        </span>
      </footer>

      {selected && (
        <div
          className={styles.dialogBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Trace event details"
            className={styles.dialog}
            ref={dialogRef}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const buttons = Array.from(
                dialogRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not([disabled])",
                ) ?? [],
              );
              if (!buttons.length) return;
              const first = buttons[0]!;
              const last = buttons.at(-1)!;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className={styles.dialogTop}>
              <span className={styles.detailKind}>
                {selectedStep ? <StepIcon step={selectedStep} source={source} event={eventsById.get(selectedStep.id)} owners={owners} autoReview={autoReview} /> : <HarnessIcon source={source} />}
                {selectedStep
                  ? kindName(selectedStep)
                  : selectedExchange
                    ? "Request span"
                    : "Session span"}
              </span>
              <button
                ref={dialogClose}
                type="button"
                aria-label="Close details"
                onClick={() => setSelectedId(null)}
              >
                <X size={16} />
              </button>
            </div>
            <h3>{selectedTitle}</h3>
            <dl>
              <div>
                <dt>Recorded</dt>
                <dd>{timestamp(selectedAt)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>
                  {selectedStep?.end !== null && selectedStep?.end !== undefined
                    ? `${formatSessionDuration(selectedStep.end - selectedStep.at)} between call and result`
                    : !selectedStep && selectedEnd > selectedAt
                      ? `${formatSessionDuration(selectedEnd - selectedAt)} recorded span`
                      : "No interval recorded"}
                </dd>
              </div>
            </dl>
            {(selectedStep?.detail || (!selectedStep && selectedExchange?.steps.find((step) => step.kind === "prompt")?.detail)) && (
              <section aria-label={selectedStep?.kind === "tool" ? "Recorded input" : "Recorded message"}>
                <h4 className={styles.detailHeading}>{selectedStep?.kind === "tool" ? "Command / input" : "Full message"}</h4>
                <pre className={styles.dialogDetail}>{selectedStep?.detail ?? selectedExchange?.steps.find((step) => step.kind === "prompt")?.detail}</pre>
              </section>
            )}
            {selectedStep?.output && (
              <section aria-label="Recorded output">
                <h4 className={styles.detailHeading}>Output</h4>
                <pre className={styles.dialogDetail}>{selectedStep.output}</pre>
              </section>
            )}
            {selectedStep?.failed && (
              <p className={styles.dialogError}>Recorded tool failure</p>
            )}
            <div className={styles.dialogActions}>
              {selectedStep?.anchor && (
                <Button size="sm" variant="secondary"
                  type="button"
                  onClick={() => {
                    onOpenTranscript(selectedStep.anchor!);
                    setSelectedId(null);
                  }}
                >
                  View in conversation →
                </Button>
              )}
              {selectedExchange && !selectedStep && (
                <Button size="sm" variant="secondary"
                  type="button"
                  onClick={() => {
                    setFocused(selectedExchange.id);
                    setSelectedId(null);
                  }}
                >
                  Focus request
                </Button>
              )}
              {focused && (
                <Button size="sm" variant="secondary"
                  type="button"
                  onClick={() => {
                    setFocused(null);
                    setSelectedId(null);
                  }}
                >
                  All activity
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
