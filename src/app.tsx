import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { FlowsApp, parseFlowsRoute } from "./flows/flows-app";
import { Settings } from "./admin/settings";
import { DevicePage } from "./device/DevicePage";
import { userCodeFromHash } from "./device/api";
import { parseRoute } from "./sessions/route";
import { Shell } from "./shell/shell";

/** Hash routes keep the static host simple (no SPA fallback needed). */
function route(hash: string) {
  // Device approval (relaycontrol redirects verification_uri here).
  if (/^#\/device(?:\?.*)?$/.test(hash))
    return { page: "device" as const, path: "", section: "" };
  const flows = /^#(\/flows(?:\/.*)?)$/.exec(hash);
  if (flows) return { page: "flows" as const, path: flows[1]!, section: "" };
  const settings = /^#\/settings(?:\/([a-z-]+))?$/.exec(hash);
  if (settings)
    return {
      page: "settings" as const,
      path: "",
      section: settings[1] ?? "workspace",
    };
  return { page: "sessions" as const, path: "", section: "" };
}

/** Hosted workspaceSection(): the rail and default topbar heading per route. */
function chrome(current: ReturnType<typeof route>) {
  if (current.page === "flows") {
    const kind = parseFlowsRoute(current.path).kind;
    return {
      rail: "Flows" as const,
      label:
        kind === "run"
          ? "Run details"
          : kind === "flow"
            ? "Flow settings"
            : kind === "runs"
              ? "Run history"
              : kind.includes("worker")
                ? "Workers"
                : "Flows",
    };
  }
  if (current.page === "settings")
    return { rail: "Settings" as const, label: "Settings" };
  return {
    rail: "Agents" as const,
    label: parseRoute(window.location).view === "session" ? "Session" : "Sessions",
  };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const current = route(hash);
  if (current.page === "device") {
    const code = userCodeFromHash(hash);
    // A different code is a different request: start the page fresh.
    return <DevicePage key={code} initialUserCode={code} />;
  }
  const { rail, label } = chrome(current);
  return (
    <Shell rail={rail} label={label}>
      {current.page === "flows" && <FlowsApp path={current.path} />}
      {current.page === "settings" && <Settings section={current.section} />}
      {current.page === "sessions" && <Dashboard />}
    </Shell>
  );
}
