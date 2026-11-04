// Agent Relay Desktop deep links (relay crates/probe/src/relay/links.rs):
//
//   <scheme>://connect?site=<origin>&account=<user id>&workspace=<workspace id>
//   <scheme>://message?to=<agent@machine>&site=<origin>
//
// Links carry destinations, never credentials or message bodies. A Desktop
// built for one deployment registers its own scheme and refuses a link that
// names any other site, so both come from the customer profile
// (`customerProfile.desktop` in /runtime-config.js, written by the image from
// DASHBOARD_CUSTOMER_PROFILE). The hosted build has no runtime config and
// shows no Desktop links.

export type DesktopLinks = {
  /** The URL scheme the deployment's Desktop registers, e.g. `agentrelay`. */
  scheme: string;
  /** The site the Desktop signs in to: a bare origin. */
  site: string;
};

export const DEFAULT_DESKTOP_SCHEME = "agentrelay";

const SCHEME = /^[a-z][a-z0-9+.-]{0,63}$/;
// Schemes a browser or OS already handles; a profile cannot hijack them.
const RESERVED_SCHEMES = new Set([
  "http", "https", "ws", "wss", "ftp", "file", "data", "blob", "javascript",
  "vbscript", "about", "mailto", "tel", "sms", "chrome", "view-source",
]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A scheme a Desktop may register, or null. */
export function desktopScheme(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const scheme = value.trim();
  return SCHEME.test(scheme) && !RESERVED_SCHEMES.has(scheme) ? scheme : null;
}

/**
 * A bare origin the Desktop may sign in to: https, or http only for a local
 * host; no user info, path, query or fragment.
 */
export function desktopSite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (text.replace(/\/$/, "") !== url.origin) return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  return null;
}

/**
 * The Desktop link settings for this deployment, or null when the dashboard
 * has no runtime config (the hosted build) or no usable site. Invalid profile
 * fields fall back on their own: the default scheme, the dashboard's origin.
 */
export function parseDesktopLinks(config: unknown, origin: string): DesktopLinks | null {
  if (!config || typeof config !== "object") return null;
  const profile = (config as { customerProfile?: unknown }).customerProfile;
  const desktop =
    profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as { desktop?: unknown }).desktop
      : undefined;
  const fields =
    desktop && typeof desktop === "object" && !Array.isArray(desktop)
      ? (desktop as { urlScheme?: unknown; siteUrl?: unknown })
      : {};
  const site = desktopSite(fields.siteUrl) ?? desktopSite(origin);
  if (!site) return null;
  return { scheme: desktopScheme(fields.urlScheme) ?? DEFAULT_DESKTOP_SCHEME, site };
}

/** This page load's Desktop link settings. */
export function desktopLinks(): DesktopLinks | null {
  if (typeof window === "undefined") return null;
  return parseDesktopLinks(window.__AGENT_RELAY_DASHBOARD_CONFIG__, window.location.origin);
}

/** Opens the Desktop's sign-in for this account and workspace. */
export function desktopConnectLink(
  links: DesktopLinks,
  accountId: string,
  workspaceId: string,
): string | null {
  if (!ID.test(accountId) || !ID.test(workspaceId)) return null;
  const query = new URLSearchParams({ site: links.site, account: accountId, workspace: workspaceId });
  return `${links.scheme}://connect?${query}`;
}

/** Opens the Desktop's composer for an exact `agent@machine` address. */
export function desktopMessageLink(links: DesktopLinks, address: string): string | null {
  const to = address.trim();
  if (!to || /\s/.test(to) || to.length > 512) return null;
  // An exact address: an `@` with something on both sides (names may hold `@`).
  if (to.startsWith("@")) return null;
  if (![...to].some((c, i) => c === "@" && i > 0 && i < to.length - 1)) return null;
  const query = new URLSearchParams({ to, site: links.site });
  return `${links.scheme}://message?${query}`;
}
