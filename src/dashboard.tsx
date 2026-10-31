import { useEffect, useRef, useState } from "react";
import { getAccount, getSessions, SignedOut } from "./api/client";
import type { Account, Session } from "./api/contracts";
import {
  conversationUrl,
  harnessName,
  sessionDate,
  sessionKey,
} from "./sessions";

export function Dashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const workspace = account?.currentWorkspace;

  useEffect(() => {
    const attempt = new AbortController();
    controller.current = attempt;
    async function load() {
      try {
        const account = await getAccount(attempt.signal);
        const page = account.currentWorkspace
          ? await getSessions(account.currentWorkspace.id, null, attempt.signal)
          : { items: [], nextCursor: null };
        if (attempt.signal.aborted) return;
        setAccount(account);
        setSessions(page.items);
        setCursor(page.nextCursor);
      } catch (error) {
        if (!attempt.signal.aborted) setError(error as Error);
      } finally {
        if (!attempt.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => attempt.abort();
  }, [reload]);

  useEffect(() => {
    if (error instanceof SignedOut)
      window.location.replace("/login?next=%2Fdashboard%2F");
  }, [error]);

  async function loadMore() {
    if (!workspace || !cursor || !controller.current || busy) return;
    const signal = controller.current.signal;
    setBusy(true);
    setError(null);
    try {
      const page = await getSessions(workspace.id, cursor, signal);
      if (signal.aborted) return;
      setSessions((rows) => [
        ...new Map(
          [...rows, ...page.items].map((row) => [sessionKey(row), row]),
        ).values(),
      ]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (!signal.aborted) setError(error as Error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  function refresh() {
    setError(null);
    setBusy(true);
    setReload((value) => value + 1);
  }
  return (
    <div className="dashboard">
      <header>
        <a className="brand" href="/dashboard/">
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" />
          <img
            className="wordmark"
            src={`${import.meta.env.BASE_URL}wordmark.svg`}
            alt="Agent Relay"
          />
        </a>
        {account && <span>{account.user.name}</span>}
      </header>
      <main>
        <div className="heading">
          <div>
            <h1>Sessions</h1>
            {workspace && <p>{workspace.name}</p>}
          </div>
          <button onClick={refresh} disabled={busy}>
            Refresh
          </button>
        </div>
        {error && (
          <p role="alert">
            {error instanceof SignedOut
              ? "Taking you to sign in…"
              : error.message}
          </p>
        )}
        {busy && !account && <p role="status">Loading sessions…</p>}
        {!busy && !error && account && sessions.length === 0 && (
          <p>
            {workspace ? "No sessions yet." : "You don’t have a workspace yet."}
          </p>
        )}
        {workspace && sessions.length > 0 && (
          <ul className="sessions">
            {sessions.map((row) => (
              <li key={sessionKey(row)}>
                <a href={conversationUrl(workspace.id, row)}>
                  <div>
                    <strong>{row.summary?.trim() || "Untitled session"}</strong>
                    <span>
                      {[harnessName(row.source), row.project?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <time dateTime={row.lastTs || undefined}>
                    {sessionDate(row.lastTs)}
                  </time>
                </a>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button
            className="more"
            onClick={() => void loadMore()}
            disabled={busy}
          >
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}
