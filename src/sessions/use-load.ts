import { useEffect, useRef, useState } from "react";

export type Load<T> = {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  /** `data` belongs to an earlier key (keepPrevious) while this one loads. */
  stale: boolean;
};

/**
 * Load data for a request key, aborting superseded requests. State is set
 * from the request's own callbacks and cleared when its key is torn down; a
 * result whose key no longer matches is treated as loading.
 * A null key loads nothing. With `keepPrevious`, the last settled data stays
 * available (marked `stale`) while a new key loads, so views update in place
 * instead of flashing a loading state.
 */
export function useLoad<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: { keepPrevious?: boolean } = {},
): Load<T> {
  const [previous, setPrevious] = useState<{ data: T } | null>(null);
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
        if (controller.signal.aborted) return;
        setState({ key, data });
        setPrevious({ data });
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
  if (key === null)
    return { data: undefined, error: null, loading: false, stale: false };
  const current = state?.key === key ? state : null;
  const keep = !current && options.keepPrevious && previous;
  return {
    data: current ? current.data : keep ? previous.data : undefined,
    error: current?.error ?? null,
    loading: !current,
    stale: !!keep,
  };
}
