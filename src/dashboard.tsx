import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getAccount, SignedOut } from "./api/client";
import type { Account } from "./api/contracts";
import { parseRoute, type SessionRoute } from "./sessions/route";
import { SessionsPage, SessionsSkeleton } from "./sessions/SessionsPage";
import { Button } from "./shell/ui";
import "./sessions/sessions.css";
import { loginHref, sessionVisualizationsEnabled } from "./app-path";

// The transcript renderer (Markdown, diff parsing) loads with the first session opened.
const SessionView = lazy(() =>
  import("./sessions/SessionView").then((module) => ({
    default: module.SessionView,
  })),
);

const GraphPage = lazy(() => import("./sessions/visualizations/GraphPage").then((module) => ({ default: module.GraphPage })));

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
  const [attempt, setAttempt] = useState(0);
  const route = useRoute();
  const workspace = account?.currentWorkspace;
  const requestedWorkspace = route.view !== "list" ? route.workspaceId : undefined;
  const workspaceMismatch = Boolean(workspace && requestedWorkspace && workspace.id !== requestedWorkspace);

  useEffect(() => {
    const request = new AbortController();
    getAccount(request.signal)
      .then((value) => {
        if (!request.signal.aborted) {
          setError(null);
          setAccount(value);
        }
      })
      .catch((reason: Error) => {
        if (!request.signal.aborted) setError(reason);
      });
    return () => request.abort();
  }, [attempt]);

  const signedOut = useCallback(() => setError(new SignedOut()), []);
  useEffect(() => {
    if (error instanceof SignedOut) {
      window.location.replace(loginHref());
    }
  }, [error]);

  return (
    <div
      className={
        route.view === "session"
          ? "flex min-h-full flex-col"
          : "flex min-h-full flex-col px-5 py-4"
      }
    >
      {error && (
        <div role="alert" className="load-error">
          <span>
            {error instanceof SignedOut
              ? "Taking you to sign in…"
              : error.message}
          </span>
          {!account && !(error instanceof SignedOut) && (
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
      {!account && !error && <SessionsSkeleton />}
      {account && !workspace && (
        <p className="text-sm text-muted-foreground">
          You don’t have a workspace yet.
        </p>
      )}
      {workspaceMismatch && <p role="status" className="p-6 text-sm text-muted-foreground">This link belongs to a different workspace.</p>}
      {workspace && !workspaceMismatch && route.view === "graph" && <Suspense fallback={<SessionsSkeleton label="Loading work graph…" />}>
        {sessionVisualizationsEnabled() ? <GraphPage key={JSON.stringify([account?.user.id, workspace.id, route.sessionId, route.source])} accountId={account?.user.id ?? ""} workspaceId={workspace.id} initialFocus={route.sessionId && route.source ? { sessionId: route.sessionId, source: route.source } : undefined} onSignedOut={signedOut} /> : <p className="p-6 text-sm text-muted-foreground">Session visualizations are not enabled.</p>}
      </Suspense>}
      {workspace && !workspaceMismatch && route.view === "list" && (
        <SessionsPage
          key={route.tab}
          workspaceId={workspace.id}
          initialQuery={route.q}
          tab={route.tab}
          onSignedOut={signedOut}
        />
      )}
      {workspace && !workspaceMismatch && route.view === "session" && (
        <Suspense fallback={<SessionsSkeleton label="Loading session…" />}>
          <SessionView
            workspaceId={workspace.id}
            sessionId={route.sessionId}
            source={route.source}
            event={route.event}
            from={route.from}
            onSignedOut={signedOut}
          />
        </Suspense>
      )}
    </div>
  );
}
