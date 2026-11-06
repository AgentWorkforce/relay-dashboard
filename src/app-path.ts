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

/**
 * A same-origin path: rejects protocol-relative (`//host`, `/\\host`) and
 * absolute URLs, which browsers would send off-origin.
 */
function sameOriginPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const leading = path.startsWith("/") ? path : `/${path}`;
  return /^\/[/\\]/.test(leading) ? null : leading;
}

/** The app's base path, always with leading and trailing slashes. */
export function appPath(): string {
  const configured = sameOriginPath(runtimeConfig().appPath);
  if (configured) return withSlashes(configured);
  return withSlashes(import.meta.env.BASE_URL || "/");
}

/** Sign-in URL that returns to `next` (defaults to the current page). */
export function loginHref(
  next = `${window.location.pathname}${window.location.search}${window.location.hash}`,
): string {
  const configured = runtimeConfig().loginPath;
  const login =
    typeof configured === "string" && configured.startsWith("/")
      ? (sameOriginPath(configured) ?? "/login")
      : "/login";
  return `${login}?next=${encodeURIComponent(next)}`;
}

/** Leave the current page. Tests replace this instead of `window.location`. */
export function redirectBrowser(href: string): void {
  window.location.replace(href);
}
