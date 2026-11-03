import { useCallback, useEffect, useState } from "react";

/** Loads data with abort-on-unmount and an explicit reload. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      },
      (failure: Error) => {
        if (!controller.signal.aborted) setError(failure);
      },
    );
    return () => controller.abort();
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
  return error instanceof Error ? error.message : "Something went wrong.";
}
