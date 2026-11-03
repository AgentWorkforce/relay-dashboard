// Where the SPA is mounted. Self-hosted installs serve it at `/` and publish
// `window.__AGENT_RELAY_DASHBOARD_CONFIG__` from /runtime-config.js (appPath,
// loginPath); hosted builds use the Vite base (`/dashboard/`). Asset URLs
// always follow the build base, so build with DASHBOARD_BASE_PATH matching
// the runtime appPath.
type RuntimeConfig = {
  appPath?: unknown;
  loginPath?: unknown;
};

declare global {
  interface Window {
    __AGENT_RELAY_DASHBOARD_CONFIG__?: RuntimeConfig;
  }
}

function runtimeConfig(): RuntimeConfig {
  return (
    (typeof window !== "undefined" &&
      window.__AGENT_RELAY_DASHBOARD_CONFIG__) ||
    {}
  );
}

function withSlashes(path: string) {
  const leading = path.startsWith("/") ? path : `/${path}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
}

/** The app's base path, always with leading and trailing slashes. */
export function appPath(): string {
  const configured = runtimeConfig().appPath;
  if (typeof configured === "string" && configured.trim())
    return withSlashes(configured.trim());
  return withSlashes(import.meta.env.BASE_URL || "/");
}

/** Sign-in URL that returns to `next` (defaults to the current page). */
export function loginHref(
  next = `${window.location.pathname}${window.location.search}${window.location.hash}`,
): string {
  const configured = runtimeConfig().loginPath;
  const login =
    typeof configured === "string" && configured.startsWith("/")
      ? configured
      : "/login";
  return `${login}?next=${encodeURIComponent(next)}`;
}
