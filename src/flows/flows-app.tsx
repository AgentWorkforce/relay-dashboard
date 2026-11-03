import { useCallback, useEffect, useRef, useState } from "react";
import { getAccount, SignedOut } from "../api/client";
import { FlowDetailPage } from "./pages/flow-detail";
import { NewFlowPage } from "./pages/flow-editor";
import { FlowsOverview, FlowsSidebar } from "./pages/overview";
import { RunDetailPage } from "./pages/run-detail";
import { AddWorkerPage, WorkerDetailPage, WorkersPage } from "./pages/workers";
import "./flows.css";
import { loginHref } from "../app-path";

type Route =
  | { kind: "flows" }
  | { kind: "runs" }
  | { kind: "new-flow" }
  | { kind: "flow"; id: string }
  | { kind: "run"; id: string }
  | { kind: "workers" }
  | { kind: "add-worker" }
  | { kind: "worker"; id: string };

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseFlowsRoute(path: string): Route {
  const decoded = path.split("/").filter(Boolean).slice(1).map(decodeSegment);
  // A malformed percent-encoding is not a valid deep link; show the overview.
  if (decoded.includes(null)) return { kind: "flows" };
  const parts = decoded as string[];
  const [section, id] = parts;
  if (section === "new") return { kind: "new-flow" };
  if (section === "f" && id) return { kind: "flow", id };
  if (section === "runs" && id) return { kind: "run", id };
  if (section === "runs") return { kind: "runs" };
  if (section === "workers" && id === "new") return { kind: "add-worker" };
  if (section === "workers" && id) return { kind: "worker", id };
  if (section === "workers") return { kind: "workers" };
  return { kind: "flows" };
}


export function FlowsApp({ path }: { path: string }) {
  // Kept apart from page errors: a page's successful poll clears its own
  // error, and must not hide a failed account request.
  const [accountError, setAccountError] = useState<Error | null>(null);
  // Each route change is a new visit. Errors are tagged with the visit that
  // raised them, so a failed request doesn't leave its alert on the next
  // page, nor resurface when the user comes back to the failed route.
  const [visit, setVisit] = useState({ path, id: 0 });
  if (visit.path !== path) setVisit({ path, id: visit.id + 1 });
  const [failure, setFailure] = useState<{ error: Error; visit: number } | null>(
    null,
  );
  const visitRef = useRef(visit.id);
  useEffect(() => {
    visitRef.current = visit.id;
  }, [visit.id]);
  const setError = useCallback(
    (next: Error | null) =>
      setFailure(next ? { error: next, visit: visitRef.current } : null),
    [],
  );
  const error =
    (failure &&
    (failure.error instanceof SignedOut || failure.visit === visit.id)
      ? failure.error
      : null) ?? accountError;
  const current = parseFlowsRoute(path);

  useEffect(() => {
    const controller = new AbortController();
    getAccount(controller.signal).then(undefined, (caught: Error) => {
      if (!controller.signal.aborted) setAccountError(caught);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (error instanceof SignedOut) window.location.replace(loginHref());
  }, [error]);

  let page;
  switch (current.kind) {
    case "flows":
    case "runs":
      page = <FlowsOverview tab={current.kind} onError={setError} />;
      break;
    case "new-flow":
      page = <NewFlowPage onError={setError} />;
      break;
    case "flow":
      page = (
        <FlowDetailPage
          key={current.id}
          flowId={current.id}
          onError={setError}
        />
      );
      break;
    case "run":
      page = (
        <RunDetailPage key={current.id} runId={current.id} onError={setError} />
      );
      break;
    case "workers":
      page = <WorkersPage onError={setError} />;
      break;
    case "add-worker":
      page = <AddWorkerPage onError={setError} />;
      break;
    case "worker":
      page = (
        <WorkerDetailPage
          key={current.id}
          workerId={current.id}
          onError={setError}
        />
      );
      break;
  }

  const overview = current.kind === "flows" || current.kind === "runs";
  const section =
    current.kind === "run" || current.kind === "runs"
      ? "runs"
      : current.kind.includes("worker")
        ? "workers"
        : "flows";
  return (
    <div className={overview ? "flows-main" : "flows-main flows-page"}>
      {/* The overview renders this with its counts. */}
      {!overview && <FlowsSidebar current={section} />}
      {error && (
        <p role="alert" className={overview ? "px-6 pt-6" : "mb-4"}>
          {error instanceof SignedOut
            ? "Taking you to sign in…"
            : error.message}
        </p>
      )}
      {page}
    </div>
  );
}
