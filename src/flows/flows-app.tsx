import { useEffect, useState } from "react";
import { getAccount, SignedOut } from "../api/client";
import type { Account } from "../api/contracts";
import { FlowDetailPage } from "./pages/flow-detail";
import { NewFlowPage } from "./pages/flow-editor";
import { FlowsOverview } from "./pages/overview";
import { RunDetailPage } from "./pages/run-detail";
import { AddWorkerPage, WorkerDetailPage, WorkersPage } from "./pages/workers";
import "./flows.css";
import { appPath, loginHref } from "../app-path";

type Route =
  | { kind: "flows" }
  | { kind: "runs" }
  | { kind: "new-flow" }
  | { kind: "flow"; id: string }
  | { kind: "run"; id: string }
  | { kind: "workers" }
  | { kind: "add-worker" }
  | { kind: "worker"; id: string };

export function parseFlowsRoute(path: string): Route {
  const parts = path
    .split("/")
    .filter(Boolean)
    .slice(1)
    .map(decodeURIComponent);
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

const SECTIONS = [
  { href: "#/flows", label: "All flows", match: ["flows", "new-flow", "flow"] },
  { href: "#/flows/runs", label: "Run history", match: ["runs", "run"] },
  {
    href: "#/flows/workers",
    label: "Workers",
    match: ["workers", "add-worker", "worker"],
  },
];

export function FlowsApp({ path }: { path: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const current = parseFlowsRoute(path);

  useEffect(() => {
    const controller = new AbortController();
    getAccount(controller.signal).then(setAccount, (caught: Error) => {
      if (!controller.signal.aborted) setError(caught);
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
      page = <NewFlowPage />;
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
      page = <AddWorkerPage />;
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

  return (
    <div className="dashboard">
      <header>
        <a className="brand" href={appPath()}>
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" />
          <img
            className="wordmark"
            src={`${import.meta.env.BASE_URL}wordmark.svg`}
            alt="Agent Relay"
          />
        </a>
        <nav className="top-nav" aria-label="Primary">
          <a href={appPath()}>Sessions</a>
          <a href="#/flows" aria-current="page">
            Flows
          </a>
          <a href="#/settings/workspace">Settings</a>
          {account && <span>{account.user.name}</span>}
        </nav>
      </header>
      <main className="flows-main">
        <div className="flows-layout">
          <nav className="flows-nav" aria-label="Flows">
            <h4>Flows</h4>
            <p>Manage your flows and follow their runs.</p>
            {SECTIONS.map((section) => (
              <a
                key={section.href}
                href={section.href}
                aria-current={
                  section.match.includes(current.kind) ? "page" : undefined
                }
              >
                {section.label}
              </a>
            ))}
            {account?.currentWorkspace && (
              <span className="workspace">{account.currentWorkspace.name}</span>
            )}
          </nav>
          <div className="flows-content">
            {error && (
              <p role="alert">
                {error instanceof SignedOut
                  ? "Taking you to sign in…"
                  : error.message}
              </p>
            )}
            {page}
          </div>
        </div>
      </main>
    </div>
  );
}
