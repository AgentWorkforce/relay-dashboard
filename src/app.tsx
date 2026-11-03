import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { Settings } from "./admin/settings";

/** Hash routes keep the static host simple (no SPA fallback needed). */
function route(hash: string) {
  const settings = /^#\/settings(?:\/([a-z-]+))?$/.exec(hash);
  if (settings)
    return { page: "settings" as const, section: settings[1] ?? "workspace" };
  return { page: "sessions" as const, section: "" };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const current = route(hash);
  if (current.page === "settings")
    return <Settings section={current.section} />;
  return <Dashboard />;
}
