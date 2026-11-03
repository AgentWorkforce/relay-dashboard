import { useEffect, useRef, useState } from "react";

export type Load<T> = {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
};

/**
 * Load data for a request key, aborting superseded requests. State is set
 * from the request's own callbacks and cleared when its key is torn down; a
 * result whose key no longer matches is treated as loading.
 * A null key loads nothing.
 */
export function useLoad<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Load<T> {
  const [state, setState] = useState<{
    key: string;
    data?: T;
    error?: Error;
  } | null>(null);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    loader.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error: error instanceof Error ? error : new Error(String(error)),
          });
      },
    );
    return () => {
      controller.abort();
      // A key that comes back later must load again, not report this result
      // as settled while its new request is in flight.
      setState((current) => (current?.key === key ? null : current));
    };
  }, [key]);
  if (key === null) return { data: undefined, error: null, loading: false };
  const current = state?.key === key ? state : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: !current,
  };
}
