import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getAccount, SignedOut } from "./api/client";
import type { Account } from "./api/contracts";
import { parseRoute, type SessionRoute } from "./sessions/route";
import { SessionsPage } from "./sessions/SessionsPage";
import "./sessions/sessions.css";

// The transcript renderer (Markdown, diff parsing) loads with the first session opened.
const SessionView = lazy(() =>
  import("./sessions/SessionView").then((module) => ({
    default: module.SessionView,
  })),
);

function useRoute(): SessionRoute {
  const [route, setRoute] = useState(() => parseRoute(window.location));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return route;
}

export function Dashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const route = useRoute();
  const workspace = account?.currentWorkspace;

  useEffect(() => {
    const attempt = new AbortController();
    getAccount(attempt.signal)
      .then((value) => {
        if (!attempt.signal.aborted) setAccount(value);
      })
      .catch((reason: Error) => {
        if (!attempt.signal.aborted) setError(reason);
      });
    return () => attempt.abort();
  }, []);

  const signedOut = useCallback(() => setError(new SignedOut()), []);
  useEffect(() => {
    if (error instanceof SignedOut) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [error]);

  return (
    <div className="dashboard">
      <header>
        <a className="brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" />
          <img
            className="wordmark"
            src={`${import.meta.env.BASE_URL}wordmark.svg`}
            alt="Agent Relay"
          />
        </a>
        {account && (
          <span>
            {[workspace?.name, account.user.name].filter(Boolean).join(" · ")}
          </span>
        )}
      </header>
      <main className={route.view === "session" ? "wide" : undefined}>
        {error && (
          <p role="alert">
            {error instanceof SignedOut
              ? "Taking you to sign in…"
              : error.message}
          </p>
        )}
        {!account && !error && <p role="status">Loading sessions…</p>}
        {account && !workspace && <p>You don’t have a workspace yet.</p>}
        {workspace && route.view === "list" && (
          <SessionsPage
            key={route.tab}
            workspaceId={workspace.id}
            initialQuery={route.q}
            tab={route.tab}
            onSignedOut={signedOut}
          />
        )}
        {workspace && route.view === "session" && (
          <Suspense fallback={<p role="status">Loading session…</p>}>
            <SessionView
              workspaceId={workspace.id}
              sessionId={route.sessionId}
              source={route.source}
              event={route.event}
              from={route.from}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}
