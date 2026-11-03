import { useEffect, useState } from "react";

export type Tone = "default" | "success" | "warning" | "danger" | "info";

export const TERMINAL = ["completed", "failed", "cancelled"];
export const isTerminal = (status: string) => TERMINAL.includes(status);

/** Mirrors the hosted dashboard: words, sentence case; the badge uppercases. */
export function statusLabel(status: string): string {
  const words = status.replace(/[._-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Unknown";
}

export function runTone(status: string): Tone {
  switch (status) {
    case "completed":
    case "succeeded":
    case "success":
      return "success";
    case "running":
    case "pending":
    case "queued":
      return "info";
    case "failed":
    case "error":
      return "danger";
    case "waiting":
    case "needs_review":
      return "warning";
    default:
      return "default";
  }
}

export function workerTone(status: string): Tone {
  return status === "online"
    ? "success"
    : status === "pending"
      ? "warning"
      : status === "revoked"
        ? "danger"
        : "default";
}

export function relativeTime(value?: string | null, now = Date.now()): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const seconds = Math.round((now - Date.parse(value)) / 1_000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? " ago" : " from now";
  if (abs < 45) return seconds >= 0 ? "just now" : "in a moment";
  if (abs < 3_600) return `${Math.round(abs / 60)}m${suffix}`;
  if (abs < 86_400) return `${Math.round(abs / 3_600)}h${suffix}`;
  return `${Math.round(abs / 86_400)}d${suffix}`;
}

export function fullTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function duration(ms?: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) return `${minutes}m ${rounded % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function bytes(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

export const shortId = (value: string) => value.slice(0, 8);

const EVENT_LABELS: Record<string, string> = {
  "run.queued": "Queued for a worker",
  "run.started": "Started locally",
  "run.assigned": "Assigned to worker",
  "run.acknowledged": "Worker acknowledged",
  "run.running": "Running",
  "run.completed": "Completed",
  "run.failed": "Failed",
  "run.cancelled": "Cancelled",
  "worker.reported_after_finish": "Worker reported after the run finished",
  "relayflow.step.started": "Step started",
  "relayflow.step.completed": "Step completed",
};
export const eventLabel = (type: string) =>
  EVENT_LABELS[type] ?? statusLabel(type);

/** Hash routes keep the static SPA deployable under any prefix without rewrites. */
export function useHashRoute(): string {
  const [route, setRoute] = useState(
    () => window.location.hash.slice(1) || "/",
  );
  useEffect(() => {
    const update = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

/** One path segment of a hash route; ids are opaque, so always encode them. */
export const seg = (value: string) => encodeURIComponent(value);

/** POSIX shell single-quoting for copied commands. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

export const go = (route: string) => {
  window.location.hash = route;
};

/**
 * Polls `load` every `intervalMs` while `active`, skipping hidden tabs and
 * never overlapping requests (the hosted dashboard's polling contract).
 */
export function usePolling(
  load: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  active: boolean,
  deps: unknown[],
): void {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    // The first tick always runs: the effect re-runs when its inputs change
    // (a run turning terminal included), and that change deserves one fresh
    // load. Later ticks only run, or reschedule, while `active`.
    const tick = async (first = false) => {
      if (inFlight || controller.signal.aborted) return;
      if (!active && !first) return;
      if (document.visibilityState === "hidden") {
        if (active) timer = setTimeout(() => void tick(), intervalMs);
        return;
      }
      inFlight = true;
      try {
        await load(controller.signal);
      } finally {
        inFlight = false;
        if (active && !controller.signal.aborted)
          timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    void tick(true);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, active, ...deps]);
}
