// Sessions list, transcript search, and team activity, following the hosted
// dashboard: free text goes to RelayHistory; `harness:`, `project:`, `is:`,
// `person:`, `updated:`, and `created:` tokens filter rows (hosted applies
// person and status in the browser too).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleCheck,
  Copy,
  CirclePause,
  FolderGit2,
  Inbox,
  RefreshCw,
  Search,
  Terminal,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useLoad } from "./use-load";
import {
  listSessions,
  searchSessions,
  type SearchMatch,
} from "./api";
import { ActivityPanel } from "./ActivityPanel";
import {
  harnessName,
  memberNames,
  projectLabel,
  promptLabel,
  shortProject,
  sessionActivity,
  sessionKey,
  sessionTitle,
  shortDate,
  toolKey,
  dateTime,
  workStates,
  type Member,
  type SessionRow,
} from "./data";
import {
  facetFilters,
  serverFilters,
  filterValue,
  matchesSearchFilters,
  matchesSessionFilters,
  VIEW_FIELDS,
  parseSessionQuery,
  removeSessionFilter,
  sessionSuggestions,
  setSessionFilter,
} from "./query";
import {
  citationHref,
  listHref,
  listState,
  onLinkClick,
  sessionHref,
} from "./route";
import { SignedOut } from "../api/client";
import { InitialsAvatar } from "../shell/account-menu";
import { useShellAccount } from "../shell/shell";
import { Button, buttonClass, Skeleton } from "../shell/ui";
import { WorkspaceViewSlot } from "../shell/view-slots";
import styles from "./sessions.module.css";
import { HarnessIcon } from "./harness-icon";

// Hosted session-table-data.ts: status dot colors and harness icons.
const STATUS_COLORS = {
  active: "var(--status-info)",
  idle: "var(--status-warning)",
  finished: "var(--status-success)",
} as const;
// Hosted ui/toggle.tsx (ToggleGroupItem) classes.
const TOGGLE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent";

const COLUMNS = [
  { id: "session", label: "Session" },
  { id: "project", label: "Project" },
  { id: "status", label: "Status" },
  { id: "people", label: "People" },
  { id: "events", label: "Events" },
  { id: "updated", label: "Updated" },
] as const;
type SessionSort = {
  column: (typeof COLUMNS)[number]["id"];
  direction: "ascending" | "descending";
};
const STATUS_ORDER = { active: 0, idle: 1, finished: 2 } as const;

/** Hosted sortSessions(): one column, ascending or descending, stable. */
function sortRows(
  rows: SessionRow[],
  sort: SessionSort,
  now: number,
  people: Map<string, string | null>,
) {
  const value = (row: SessionRow): string | number => {
    switch (sort.column) {
      case "session":
        return sessionTitle(row).toLowerCase();
      case "project":
        return (projectLabel(row)?.name ?? "").toLowerCase();
      case "status":
        return STATUS_ORDER[sessionActivity(row, now)];
      case "people":
        return row.userIds
          .map((id) => people.get(id) || "")
          .join(", ")
          .toLowerCase();
      case "events":
        return row.eventCount ?? -1;
      case "updated":
        return row.lastTs ? Date.parse(row.lastTs) || 0 : 0;
    }
  };
  const sign = sort.direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return left < right ? -sign : left > right ? sign : 0;
  });
}

/** Hosted relativeTime(): "Just now", "12m ago", "3h ago", "2d ago"… */
export function relativeTime(value: string | null, now: number) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  const days = Math.floor(minutes / 1440);
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

type Tab = "sessions" | "activity" | "search";

function useSignedOut(error: Error | null | undefined, onSignedOut: () => void) {
  useEffect(() => {
    if (error instanceof SignedOut) onSignedOut();
  }, [error, onSignedOut]);
}

function useDebounced<T>(value: T, delay = 300) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return current;
}

export function SessionsPage({
  workspaceId,
  initialQuery,
  tab,
  onSignedOut,
}: {
  workspaceId: string;
  initialQuery: string;
  tab: Tab;
  onSignedOut: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query);
  useEffect(() => {
    // Keep the URL shareable without adding history entries per keystroke.
    window.history.replaceState(null, "", listHref(debounced, tab));
  }, [debounced, tab]);

  return (
    <section className={styles.sessions}>
      <WorkspaceViewSlot name="heading">
        <div className={styles.heading}>
          <h1>Sessions</h1>
        </div>
      </WorkspaceViewSlot>
      <WorkspaceViewSlot name="toolbar">
        <nav
          className="flex items-center gap-1"
          aria-label="Sessions views"
        >
          {(["sessions", "search"] as const).map((name) => (
            <a
              key={name}
              href={listHref(query, name)}
              aria-current={
                tab === name || (name === "sessions" && tab === "activity")
                  ? "page"
                  : undefined
              }
              onClick={onLinkClick}
              data-slot="button"
              className={buttonClass(
                "ghost",
                "sm",
                "text-xs font-medium text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
              )}
            >
              {name === "sessions" ? "Sessions" : "Search messages"}
            </a>
          ))}
        </nav>
      </WorkspaceViewSlot>
      {tab !== "sessions" && (
        <div className={styles.tableToolbar}>
          <SearchBox query={query} onChange={setQuery} tab={tab} />
        </div>
      )}
      {tab !== "sessions" && <UnusedFilters query={query} view={tab} />}
      {tab === "sessions" && (
        <ActivityPanel
          workspaceId={workspaceId}
          query={parseSessionQuery(debounced).text}
          onSignedOut={onSignedOut}
        />
      )}
      {tab === "sessions" && (
        <SessionList
          workspaceId={workspaceId}
          query={debounced}
          liveQuery={query}
          onQuery={setQuery}
          onSignedOut={onSignedOut}
        />
      )}
      {tab === "search" && (
        <MessageSearch
          workspaceId={workspaceId}
          query={debounced}
          onSignedOut={onSignedOut}
        />
      )}
      {tab === "activity" && (
        <ActivityPanel
          workspaceId={workspaceId}
          query={parseSessionQuery(debounced).text}
          onSignedOut={onSignedOut}
        />
      )}
    </section>
  );
}

/** Hosted dashboard/sessions/loading.tsx: table-shaped skeleton rows. */
export function SessionsSkeleton({ label = "Loading sessions…" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Hosted session-search.tsx search bar (the inline field, without the command panel). */
function SearchBox({
  query,
  onChange,
  tab,
}: {
  query: string;
  onChange: (value: string) => void;
  tab: Tab;
}) {
  const filters = parseSessionQuery(query).filters;
  return (
    <div className={styles.searchControl}>
      <div className={styles.searchBar}>
        <label className={styles.searchTrigger}>
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            data-slot="input-group-control"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={
              tab === "search"
                ? "Search prompts, replies, and tool output…"
                : "Search sessions, or filter with harness: project: is: person: updated:"
            }
            value={query}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        {filters.length > 0 && (
          <ul className={styles.searchChips} aria-label="Active filters">
            {filters.map((filter) => (
              <li key={filter.raw}>
                <button
                  type="button"
                  aria-label={`Remove filter ${filter.raw}`}
                  onClick={() => onChange(removeSessionFilter(query, filter.raw))}
                >
                  {filter.raw}
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Tokens a view can't apply are named, rather than shown as if active. */
function UnusedFilters({
  query,
  view,
}: {
  query: string;
  view: "search" | "activity";
}) {
  const unused = parseSessionQuery(query).filters.filter(
    (filter) => filter.value && !VIEW_FIELDS[view].has(filter.field),
  );
  if (!unused.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Not applied in {view === "search" ? "message search" : "activity"}:{" "}
      {unused.map((filter) => filter.raw).join(" ")}
    </p>
  );
}

const STATUS_ICONS = {
  active: Zap,
  idle: CirclePause,
  finished: CircleCheck,
} as const;


/** Hosted sessions-table.tsx sidebar filters: People, Status, Harness, Project. */
function SidebarFilters({
  rows,
  members,
  query,
  onQuery,
  now,
}: {
  rows: SessionRow[];
  members: Member[];
  query: string;
  onQuery: (value: string) => void;
  now: number;
}) {
  const suggestions = useMemo(
    () => sessionSuggestions(rows, members, now),
    [rows, members, now],
  );
  const currentUserId = useShellAccount()?.user.id;
  // Each option's count once per change of rows, query, or clock.
  const counts = useMemo(() => {
    const totals = new Map<string, number>();
    const fields = ["person", "is", "harness", "project"];
    for (const field of fields) {
      const values = [
        null,
        ...suggestions
          .filter((item) => item.field === field)
          .map((item) => item.value),
      ];
      for (const value of values) {
        const filter = setSessionFilter(query, field, value);
        totals.set(
          `${field}\u0000${value ?? ""}`,
          rows.filter((row) => matchesSessionFilters(row, filter, now)).length,
        );
      }
    }
    return totals;
  }, [rows, query, now, suggestions]);
  const count = (field: string, value: string | null) =>
    counts.get(`${field}\u0000${value ?? ""}`) ?? 0;
  const present = new Set(rows.map((row) => toolKey(row.source)));
  const section = (
    field: string,
    title: string,
    allLabel: string,
    AllIcon: typeof Users,
    options: { value: string; title: string; icon: ReactNode }[],
  ) => {
    const active = filterValue(query, field);
    const row = (value: string, label: string, icon: ReactNode) => (
      <button
        key={value || "all"}
        type="button"
        data-slot="toggle"
        data-state={active === value ? "on" : "off"}
        aria-pressed={active === value}
        aria-label={label}
        className={`${TOGGLE} ${styles.filterRow}`}
        onClick={() => onQuery(setSessionFilter(query, field, value || null))}
      >
        {icon}
        <span className={styles.filterName}>{label}</span>
        <span className={styles.count}>{count(field, value || null)}</span>
      </button>
    );
    return (
      <div className={styles.filterSection}>
        <h2 className={styles.sectionLabel}>{title}</h2>
        <div
          role="group"
          aria-label={`Filter by ${title.toLowerCase()}`}
          className={`flex flex-col gap-1 ${styles.filterGroup}`}
        >
          {row("", allLabel, <AllIcon aria-hidden="true" />)}
          {options.map((option) => row(option.value, option.title, option.icon))}
        </div>
      </div>
    );
  };
  const of = (field: string) => suggestions.filter((item) => item.field === field);
  return (
    <WorkspaceViewSlot name="sidebar">
      <div className={styles.filters}>
        {members.length > 0 &&
          section(
            "person",
            "People",
            "Everyone",
            Users,
            of("person").map((item) => ({
              value: item.value,
              title:
                item.value === currentUserId ? `${item.title} (you)` : item.title,
              icon: <InitialsAvatar name={item.title} size={18} single />,
            })),
          )}
        {section(
          "is",
          "Status",
          "All sessions",
          Inbox,
          of("is").map((item) => {
            const Icon = STATUS_ICONS[item.value as keyof typeof STATUS_ICONS];
            return {
              value: item.value,
              title: item.title,
              icon: <Icon aria-hidden="true" />,
            };
          }),
        )}
        {section(
          "harness",
          "Harness",
          "All harnesses",
          Terminal,
          of("harness")
            .filter((item) => present.has(item.value))
            .map((item) => ({
              value: item.value,
              title: item.title,
              icon: <HarnessIcon source={item.value} className="size-4 shrink-0" />,
            })),
        )}
        {of("project").length > 0 &&
          section(
            "project",
            "Project",
            "All projects",
            FolderGit2,
            of("project").map((item) => ({
              value: item.value,
              title: item.title,
              icon: <FolderGit2 aria-hidden="true" />,
            })),
          )}
      </div>
    </WorkspaceViewSlot>
  );
}

function SessionList({
  workspaceId,
  query,
  liveQuery,
  onQuery,
  onSignedOut,
}: {
  workspaceId: string;
  query: string;
  /** The undebounced query, shown in the search field. */
  liveQuery: string;
  onQuery: (value: string) => void;
  onSignedOut: () => void;
}) {
  const [reload, setReload] = useState(0);
  const [appended, setAppended] = useState<{
    key: string;
    rows: SessionRow[];
    nextCursor: string | null;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailure, setMoreFailure] = useState<{
    key: string;
    error: Error;
  } | null>(null);
  const [sort, setSort] = useState<SessionSort>({
    column: "updated",
    direction: "descending",
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [copyStatus, setCopyStatus] = useState("");
  // Project ids seen in any page, so a facet pick can be matched exactly.
  const [knownProjects, setKnownProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const filters = useMemo(
    () => serverFilters(query, knownProjects),
    [query, knownProjects],
  );
  const key = JSON.stringify([workspaceId, filters, reload]);
  const page = useLoad(key, (signal) =>
    listSessions(workspaceId, filters, null, signal),
  );
  // Facet options and counts ignore the project and harness picks.
  const baseFilters = useMemo(() => facetFilters(filters), [filters]);
  const narrowed = baseFilters.project !== filters.project || baseFilters.source !== filters.source;
  const baseKey = narrowed ? JSON.stringify([workspaceId, baseFilters, reload, "facets"]) : null;
  const base = useLoad(baseKey, (signal) =>
    listSessions(workspaceId, baseFilters, null, signal),
  );
  // The facet query whose next page is in flight (per query, not global).
  const [facetBusy, setFacetBusy] = useState<string | null>(null);
  const [facetFailure, setFacetFailure] = useState<string | null>(null);
  const [baseAppended, setBaseAppended] = useState<{
    key: string | null;
    rows: SessionRow[];
    nextCursor: string | null;
  } | null>(null);
  // A load-more failure belongs to the request it was raised for.
  const moreError = moreFailure?.key === key ? moreFailure.error : null;
  useSignedOut(page.error ?? moreError, onSignedOut);
  const extra = appended?.key === key ? appended : null;
  const rows = useMemo(
    () =>
      page.data
        ? [
            ...new Map(
              [...page.data.items, ...(extra?.rows ?? [])].map((row) => [
                sessionKey(row),
                row,
              ]),
            ).values(),
          ]
        : [],
    [page.data, extra],
  );
  // Facet options and counts read every session seen for this text and date
  // query: the unnarrowed facet pages and every list page. A pick never drops
  // an option the user has already loaded.
  const facetScope = JSON.stringify([workspaceId, baseFilters, reload]);
  const [seen, setSeen] = useState<{
    scope: string;
    rows: ReadonlyMap<string, SessionRow>;
  }>({ scope: facetScope, rows: new Map() });
  const baseExtra = baseAppended?.key === baseKey ? baseAppended : null;
  const incoming = [
    ...(narrowed ? [...(base.data?.items ?? []), ...(baseExtra?.rows ?? [])] : []),
    ...rows,
  ];
  const seenRows = useMemo(
    () => (seen.scope === facetScope ? seen.rows : new Map<string, SessionRow>()),
    [seen, facetScope],
  );
  // Later pages win for a session seen twice (the list after the facet page).
  const latest = new Map(incoming.map((row) => [sessionKey(row), row]));
  if (
    seen.scope !== facetScope ||
    [...latest].some(([id, row]) => seenRows.get(id) !== row)
  ) {
    setSeen({ scope: facetScope, rows: new Map([...seenRows, ...latest]) });
  }
  const facetRows = useMemo(() => [...seenRows.values()], [seenRows]);
  const baseCursor = narrowed
    ? baseExtra
      ? baseExtra.nextCursor
      : (base.data?.nextCursor ?? null)
    : null;
  const seenProjects = useMemo(
    () =>
      [...rows, ...facetRows]
        .map((row) => row.projectId)
        .filter((id): id is string => !!id && !knownProjects.has(id)),
    [rows, facetRows, knownProjects],
  );
  // Learning a project id is a one-way set update; it settles after one pass.
  if (seenProjects.length)
    setKnownProjects(new Set([...knownProjects, ...seenProjects]));
  const members = page.data?.members ?? [];
  const cursor = extra ? extra.nextCursor : (page.data?.nextCursor ?? null);
  const now = page.data?.now
    ? Date.parse(page.data.now)
    : Date.parse(new Date().toISOString());
  const busy = page.loading || moreBusy;
  const error = page.error ?? moreError;

  async function loadMoreFacets() {
    if (!narrowed || !baseCursor || facetBusy === baseKey) return;
    const requestKey = baseKey;
    setFacetBusy(requestKey);
    setFacetFailure(null);
    try {
      const facets = await listSessions(
        workspaceId,
        baseFilters,
        baseCursor,
        new AbortController().signal,
      );
      setBaseAppended((current) => ({
        key: requestKey,
        rows: [
          ...(current?.key === requestKey ? current.rows : []),
          ...facets.items,
        ],
        nextCursor: facets.nextCursor,
      }));
    } catch {
      setFacetFailure(requestKey);
    } finally {
      setFacetBusy((current) => (current === requestKey ? null : current));
    }
  }

  async function loadMore() {
    if (!cursor || busy) return;
    setMoreBusy(true);
    setMoreFailure(null);
    // The facet pages advance with the list, on their own: a slow or failed
    // sidebar page never holds back the table.
    void loadMoreFacets();
    try {
      const next = await listSessions(
        workspaceId,
        filters,
        cursor,
        new AbortController().signal,
      );
      setAppended({
        key,
        rows: [...(extra?.rows ?? []), ...next.items],
        nextCursor: next.nextCursor,
      });
    } catch (reason) {
      setMoreFailure({ key, error: reason as Error });
    } finally {
      setMoreBusy(false);
    }
  }

  const people = new Map(members.map((member) => [member.id, member.name]));
  const visible = sortRows(
    rows.filter((row) => matchesSessionFilters(row, query, now)),
    sort,
    now,
    people,
  );
  const selectedRows = visible.filter((row) => selected.has(sessionKey(row)));
  const selectRows = (targets: SessionRow[], checked: boolean) => {
    setCopyStatus("");
    setSelected((current) => {
      const next = new Set(current);
      for (const row of targets)
        if (checked) next.add(sessionKey(row));
        else next.delete(sessionKey(row));
      return next;
    });
  };
  async function copySelectedLinks() {
    const links = selectedRows.map(
      (row) =>
        new URL(sessionHref(row.sessionId, row.source), window.location.href)
          .href,
    );
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      setCopyStatus(
        `Copied ${links.length} ${links.length === 1 ? "link" : "links"}`,
      );
    } catch {
      setCopyStatus("Couldn’t copy the links");
    }
  }
  const identityCount = Math.max(1, ...visible.map((row) => row.userIds.length + 1));
  const identityColumnWidth = 12 + 22 + (identityCount - 1) * 13;
  return (
    <>
      {narrowed &&
        ((base.error && !(base.error instanceof SignedOut)) ||
          (facetFailure !== null && facetFailure === baseKey)) && (
          <WorkspaceViewSlot name="sidebar">
            <p role="status" className="px-2 pb-2 text-[11px] text-muted-foreground">
              Couldn’t load every filter option; counts cover the loaded
              sessions.{" "}
              {facetFailure === baseKey && (
                <button
                  type="button"
                  className="more-lines underline underline-offset-4 hover:text-foreground"
                  onClick={() => void loadMoreFacets()}
                  disabled={facetBusy === baseKey}
                >
                  Retry
                </button>
              )}
            </p>
          </WorkspaceViewSlot>
        )}
      {narrowed && baseCursor && facetFailure !== baseKey && (
        // Sidebar pages can always be continued, even after the table's last
        // page or while an earlier sidebar page was still loading.
        <WorkspaceViewSlot name="sidebar">
          <p className="px-2 pb-2 text-[11px] text-muted-foreground">
            Options cover the loaded sessions.{" "}
            <button
              type="button"
              className="more-lines underline underline-offset-4 hover:text-foreground"
              onClick={() => void loadMoreFacets()}
              disabled={facetBusy === baseKey}
            >
              {facetBusy === baseKey ? "Loading…" : "Load more options"}
            </button>
          </p>
        </WorkspaceViewSlot>
      )}
      <SidebarFilters
        rows={facetRows}
        members={members}
        query={query}
        onQuery={onQuery}
        now={now}
      />
      <div
        className={styles.tableToolbar}
        role="group"
        aria-label="Session view controls"
      >
        <SearchBox query={liveQuery} onChange={onQuery} tab="sessions" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => setReload((value) => value + 1)}
          disabled={busy}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      {selectedRows.length > 0 && (
        <div
          className={styles.selectionToolbar}
          role="group"
          aria-label="Selected sessions"
        >
          <span>{selectedRows.length} selected</span>
          <Button variant="ghost" size="sm" onClick={() => void copySelectedLinks()}>
            <Copy aria-hidden="true" />
            Copy session links
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(new Set());
              setCopyStatus("");
            }}
          >
            Clear selection
          </Button>
          <span role="status">{copyStatus}</span>
        </div>
      )}
      {busy && rows.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Updating sessions… Showing previous results.
        </p>
      )}
      {error && (
        <p role="alert">
          {error instanceof SignedOut ? "Taking you to sign in…" : error.message}
        </p>
      )}
      {busy && rows.length === 0 && !error && <SessionsSkeleton />}
      {(!busy || rows.length > 0) && (!error || rows.length > 0) && (
        <div className={styles.tableSurface} style={{ flex: "0 0 auto" }}>
          <table
            className={`w-full caption-bottom text-sm ${styles.sessionsTable}`}
            style={{ minWidth: 44 + identityColumnWidth + 940 }}
          >
            <caption className="sr-only">
              Coding sessions, most recently updated first
            </caption>
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: identityColumnWidth }} />
              <col style={{ width: "36%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className={styles.selectionCell}>
                  <input
                    type="checkbox"
                    className={styles.selectionCheckbox}
                    aria-label="Select all visible sessions"
                    checked={
                      visible.length > 0 &&
                      selectedRows.length === visible.length
                    }
                    ref={(element) => {
                      if (element)
                        element.indeterminate =
                          selectedRows.length > 0 &&
                          selectedRows.length < visible.length;
                    }}
                    onChange={(event) =>
                      selectRows(visible, event.target.checked)
                    }
                  />
                </th>
                <th>
                  <span className="sr-only">Session identity</span>
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      sort.column === column.id ? sort.direction : undefined
                    }
                    className="h-9 px-3 text-left text-xs font-medium"
                  >
                    <Button
                      variant="ghost"
                      size="xs"
                      className="-ml-1.5 max-w-full"
                      aria-label={`Sort by ${column.label}`}
                      onClick={() =>
                        setSort((current) => ({
                          column: column.id,
                          direction:
                            current.column === column.id
                              ? current.direction === "ascending"
                                ? "descending"
                                : "ascending"
                              : column.id === "updated" || column.id === "events"
                                ? "descending"
                                : "ascending",
                        }))
                      }
                    >
                      <span className="truncate">{column.label}</span>
                      {sort.column !== column.id ? (
                        <ArrowUpDown aria-hidden="true" />
                      ) : sort.direction === "ascending" ? (
                        <ArrowUp aria-hidden="true" />
                      ) : (
                        <ArrowDown aria-hidden="true" />
                      )}
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const title = sessionTitle(row);
                const project = projectLabel(row);
                const key = sessionActivity(row, now);
                const names = row.userIds.map(
                  (id) => people.get(id) || "Unknown teammate",
                );
                const identityLabel = [harnessName(row.source), ...names].join(
                  " · ",
                );
                return (
                  <tr
                    key={sessionKey(row)}
                    className={styles.sessionRow}
                    data-selected={selected.has(sessionKey(row)) || undefined}
                  >
                    <td className={styles.selectionCell}>
                      <input
                        type="checkbox"
                        className={styles.selectionCheckbox}
                        aria-label={`Select ${title}`}
                        checked={selected.has(sessionKey(row))}
                        onChange={(event) =>
                          selectRows([row], event.target.checked)
                        }
                      />
                    </td>
                    <td className={styles.harnessIconCell}>
                      <span
                        className={styles.identityStack}
                        role="img"
                        aria-label={identityLabel}
                        title={identityLabel}
                      >
                        {names.map((name, index) => (
                          <InitialsAvatar
                            key={`${row.userIds[index]}`}
                            name={name}
                            size={22}
                            single
                            className={styles.identityAvatar}
                          />
                        ))}
                        <span className={styles.identityTool} aria-hidden="true">
                          <HarnessIcon source={row.source} className="size-5 shrink-0" />
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={sessionHref(
                          row.sessionId,
                          row.source,
                          null,
                          listState(query, "sessions"),
                        )}
                        onClick={onLinkClick}
                        title={title}
                        aria-label={title}
                        className={`${styles.sessionLink} flex min-w-0 items-center gap-2 font-medium`}
                      >
                        <span className={styles.sessionTitle}>
                          <span className="truncate">{title}</span>
                          <span className={styles.executionDetails}>
                            {[harnessName(row.source), row.models[0]]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </a>
                      {(row.parentSessionIds.length > 0 ||
                        row.childSessionCount > 0) && (
                        <span className="relative z-10 mt-1 flex gap-2 text-xs text-muted-foreground">
                          {row.parentSessionIds.length > 0 && <span>Subagent</span>}
                          {row.childSessionCount > 0 && (
                            <span>
                              {row.childSessionCount}{" "}
                              {row.childSessionCount === 1 ? "subagent" : "subagents"}
                            </span>
                          )}
                        </span>
                      )}
                      {row.search?.snippet && (
                        <span className="relative z-10 mt-1 block truncate text-xs text-muted-foreground">
                          {row.search.snippet}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="block truncate text-muted-foreground"
                        title={project?.detail || project?.name}
                      >
                        {project?.name ?? "Not recorded"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-2.5 whitespace-nowrap text-muted-foreground"
                        title={workStates[key].description}
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: STATUS_COLORS[key] }}
                        />
                        {workStates[key].label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="block truncate text-muted-foreground"
                        title={names.join(", ")}
                      >
                        {names.length ? names.join(", ") : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="tabular-nums text-muted-foreground">
                        {row.eventCount ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <time
                        className="relative z-10 whitespace-nowrap text-muted-foreground"
                        dateTime={row.lastTs ?? undefined}
                        title={dateTime(row.lastTs)}
                      >
                        {relativeTime(row.lastTs, now)}
                      </time>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && !busy && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-12 text-center text-muted-foreground"
                  >
                    {rows.length ? (
                      "No sessions match these filters."
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <p>
                          No sessions yet. Connect your computer to start
                          syncing.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {visible.length} {visible.length === 1 ? "session" : "sessions"}
          {cursor ? " loaded · Filters apply to loaded sessions" : ""}
        </span>
        {cursor && (
          <button
            type="button"
            className="underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => void loadMore()}
            disabled={busy}
          >
            {busy ? "Loading…" : "Older sessions"}
          </button>
        )}
      </footer>
    </>
  );
}

function MessageSearch({
  workspaceId,
  query,
  onSignedOut,
}: {
  workspaceId: string;
  query: string;
  onSignedOut: () => void;
}) {
  const filters = useMemo(() => serverFilters(query), [query]);
  const key = filters.q ? JSON.stringify([workspaceId, filters]) : null;
  const page = useLoad(key, (signal) =>
    searchSessions(workspaceId, filters, null, signal),
  );
  const [appended, setAppended] = useState<{
    key: string;
    matches: SearchMatch[];
    nextCursor: string | null;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailure, setMoreFailure] = useState<{
    key: string | null;
    error: Error;
  } | null>(null);
  const moreError = moreFailure?.key === key ? moreFailure.error : null;
  useSignedOut(page.error ?? moreError, onSignedOut);
  const extra = appended && appended.key === key ? appended : null;
  const matches = [
    ...(page.data?.matches ?? []),
    ...(extra?.matches ?? []),
  ].filter((match) => matchesSearchFilters(match, query));
  const members = page.data?.members ?? [];
  const cursor = extra ? extra.nextCursor : (page.data?.nextCursor ?? null);
  const busy = page.loading || moreBusy;
  const error = page.error ?? moreError;

  async function loadMore() {
    if (!cursor || !key) return;
    setMoreBusy(true);
    setMoreFailure(null);
    try {
      const next = await searchSessions(
        workspaceId,
        filters,
        cursor,
        new AbortController().signal,
      );
      setAppended({
        key,
        matches: [...(extra?.matches ?? []), ...next.matches],
        nextCursor: next.nextCursor,
      });
    } catch (reason) {
      setMoreFailure({ key, error: reason as Error });
    } finally {
      setMoreBusy(false);
    }
  }

  if (!filters.q)
    return (
      <p className="dim">
        Type to search every recorded message in this workspace.
      </p>
    );
  return (
    <>
      {error && (
        <p role="alert">
          {error instanceof SignedOut ? "Taking you to sign in…" : error.message}
        </p>
      )}
      {busy && matches.length === 0 && <p role="status">Searching…</p>}
      {!busy && !error && matches.length === 0 && <p>No messages match.</p>}
      <ul className="matches">
        {matches.map((match) => {
          // Without a citation path, link the match's session directly.
          const href =
            citationHref(
              match.citationPath,
              match.eventId,
              listState(query, "search"),
            ) ??
            (match.sessionId && match.source
              ? sessionHref(
                  match.sessionId,
                  match.source,
                  match.eventId,
                  listState(query, "search"),
                )
              : null);
          const who =
            match.actorRole === "user" || match.kind === "prompt"
              ? ((match.userId
                  ? memberNames([match.userId], members)[0]
                  : null) ?? "User")
              : match.actorName ||
                (match.source ? harnessName(match.source) : "Agent");
          return (
            <li key={match.eventId}>
              <a
                href={href ?? "#"}
                onClick={(event) => {
                  if (!href) return;
                  onLinkClick(event);
                }}
              >
                <span className="match-meta">
                  {[
                    who,
                    match.toolName,
                    promptLabel(match.taskTitle),
                    match.projectId ? shortProject(match.projectId) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  <time dateTime={match.ts}>{shortDate(match.ts)}</time>
                </span>
                <span className="snippet">
                  {(match.actorRole === "user" || match.kind === "prompt"
                    ? promptLabel(match.content, 600)
                    : null) ??
                    match.content ??
                    "(no text)"}
                  {match.contentTruncated ? "…" : ""}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {cursor && (
        <button
          className="more"
          onClick={() => void loadMore()}
          disabled={busy}
        >
          {busy ? "Loading…" : "More results"}
        </button>
      )}
    </>
  );
}
