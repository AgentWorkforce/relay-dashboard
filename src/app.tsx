import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { FlowsApp } from "./flows/flows-app";
import { Settings } from "./admin/settings";
import { DevicePage } from "./device/DevicePage";
import { userCodeFromHash } from "./device/api";

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
  if (current.page === "flows") return <FlowsApp path={current.path} />;
  if (current.page === "settings")
    return <Settings section={current.section} />;
  return <Dashboard />;
}
