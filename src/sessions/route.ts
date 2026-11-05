// In-app routes. Links use query parameters on the app's base path so they
// work on any static host without a history fallback. Hosted-style citation
// paths (`…/dashboard/sessions/<id>?source=<source>`) are accepted as well.
import { appPath } from "../app-path";
export type SessionRoute =
  | { view: "list"; q: string; tab: "sessions" | "activity" | "search" }
  | { view: "graph"; sessionId?: string; source?: string; workspaceId?: string }
  | {
      view: "session";
      workspaceId?: string;
      sessionId: string;
      source: string;
      event: string | null;
      /** The list query (`q`, `tab`) to return to, so filters survive a visit. */
      from: string | null;
    };

const base = () => appPath();

export function parseRoute(location: {
  pathname: string;
  search: string;
  hash?: string;
}): SessionRoute {
  const params = new URLSearchParams(location.search);
  const workspace = params.get("workspace");
  if (params.get("view") === "graph") return {
    view: "graph", ...(workspace ? { workspaceId: workspace } : {}),
    ...(params.get("session") && params.get("source") ? { sessionId: params.get("session")!, source: params.get("source")! } : {}),
  };
  const hostedPath = /\/sessions\/([^/]+)\/?$/.exec(location.pathname);
  const sessionId =
    params.get("session") ?? (hostedPath ? safeDecode(hostedPath[1]!) : null);
  const source = params.get("source");
  if (sessionId && source) {
    const anchor = location.hash?.replace(/^#/, "") || null;
    return {
      view: "session",
      ...(workspace ? { workspaceId: workspace } : {}),
      sessionId,
      source,
      event: params.get("event") ?? anchorEvent(anchor),
      from: params.get("from"),
    };
  }
  const tab = params.get("tab");
  return {
    view: "list",
    q: params.get("q") ?? "",
    tab: tab === "activity" || tab === "search" ? tab : "sessions",
  };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `#message-<eventId>` and `#cell-<eventId>:<n>` are hosted transcript anchors. */
function anchorEvent(anchor: string | null) {
  const match = anchor
    ? /^(?:message|cell)-(.+?)(?::\d+)?$/.exec(anchor)
    : null;
  return match ? match[1]! : null;
}

export function sessionHref(
  sessionId: string,
  source: string,
  event?: string | null,
  from?: string | null,
  workspaceId?: string,
) {
  const params = new URLSearchParams({ session: sessionId, source });
  if (workspaceId) params.set("workspace", workspaceId);
  if (event) params.set("event", event);
  if (from) params.set("from", from);
  return `${base()}?${params}`;
}

export function listHref(
  q = "",
  tab: "sessions" | "activity" | "search" = "sessions",
) {
  const params = new URLSearchParams();
  if (tab !== "sessions") params.set("tab", tab);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${base()}?${query}` : base();
}

/** The list URL a session page returns to, keeping its filters. */
export function backHref(from: string | null) {
  if (!from) return listHref();
  const params = new URLSearchParams(from);
  const tab = params.get("tab");
  return listHref(
    params.get("q") ?? "",
    tab === "activity" || tab === "search" ? tab : "sessions",
  );
}

/** The `from` value for links out of a list view. */
export function listState(q: string, tab: "sessions" | "activity" | "search") {
  const params = new URLSearchParams();
  if (tab !== "sessions") params.set("tab", tab);
  if (q) params.set("q", q);
  return params.toString() || null;
}

/** Convert an API citation path into an in-app link. */
export function citationHref(
  path: string | null | undefined,
  event?: string | null,
  from?: string | null,
) {
  if (!path) return null;
  let url: URL;
  try {
    url = new URL(path, "https://relay.invalid");
  } catch {
    // A malformed citation stays non-navigable instead of breaking search.
    return null;
  }
  const route = parseRoute({ pathname: url.pathname, search: url.search });
  return route.view === "session"
    ? sessionHref(route.sessionId, route.source, event, from)
    : null;
}

export function navigate(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Let in-app links navigate without reloading, keeping modifier clicks. */
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href")!);
}

export function graphHref(workspaceId: string, focus?: { sessionId: string; source: string }) {
  return `${base()}?${new URLSearchParams({ view: "graph", workspace: workspaceId, ...(focus ?? {}) })}`;
}
