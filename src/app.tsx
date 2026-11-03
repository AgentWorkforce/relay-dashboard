import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { FlowsApp } from "./flows/flows-app";

/** Hash routes keep the static host simple (no SPA fallback needed). */
function route(hash: string) {
  const flows = /^#(\/flows(?:\/.*)?)$/.exec(hash);
  if (flows) return { page: "flows" as const, path: flows[1]! };
  return { page: "sessions" as const, path: "" };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const current = route(hash);
  if (current.page === "flows") return <FlowsApp path={current.path} />;
  return <Dashboard />;
}
