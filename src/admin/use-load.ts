import { useCallback, useEffect, useRef, useState } from "react";
import { SignedOut } from "./api";

/**
 * Loads data with abort-on-unmount and an explicit reload. A reload does not
 * abort the request in flight (a slow response would otherwise never land
 * while something keeps reloading); the newest response to arrive wins and
 * older ones that arrive later are dropped.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const issued = useRef(0);
  const applied = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    const pending = controllers.current;
    return () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);
  useEffect(() => {
    const id = ++issued.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const settle = (apply: () => void) => {
      controllers.current.delete(controller);
      if (controller.signal.aborted || id < applied.current) return;
      applied.current = id;
      apply();
    };
    load(controller.signal).then(
      (value) =>
        settle(() => {
          setData(value);
          setError(null);
        }),
      (failure: Error) => settle(() => setError(failure)),
    );
    // `load` is recreated each render by callers; reload is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { data, error, reload };
}

export function formatDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function message(error: unknown) {
  if (error instanceof SignedOut)
    return "Your session has expired. Reload the page and sign in again.";
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong.";
}
