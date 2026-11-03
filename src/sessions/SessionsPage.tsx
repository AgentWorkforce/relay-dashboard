// Sessions list, transcript search, and team activity, following the hosted
// dashboard: free text goes to RelayHistory; `harness:`, `project:`, `is:`,
// `person:`, `updated:`, and `created:` tokens filter rows (hosted applies
// person and status in the browser too).
import { useEffect, useMemo, useState } from "react";
import { useLoad } from "./use-load";
import { listSessions, searchSessions, type SearchMatch } from "./api";
import { ActivityPanel } from "./ActivityPanel";
import {
  harnessName,
  memberNames,
  projectName,
  sessionActivity,
  sessionKey,
  sessionTitle,
  shortDate,
  toolColor,
  workStates,
  type Member,
  type SessionRow,
} from "./data";
import {
  filterValue,
  matchesSessionFilters,
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

type Tab = "sessions" | "activity" | "search";

/** Server-side filters derived from the query tokens. */
function serverFilters(q: string) {
  const parsed = parseSessionQuery(q);
  const single = (field: string) => {
    const matches = parsed.filters.filter(
      (filter) => filter.field === field && !filter.exclude && filter.value,
    );
    return matches.length === 1 ? matches[0]!.value : undefined;
  };
  const updated = parsed.filters.find(
    (filter) => filter.field === "updated" && !filter.exclude,
  );
  const date = updated?.value.match(/^(>=|>)?(\d{4}-\d{2}-\d{2})$/);
  return {
    q: parsed.text.trim() || undefined,
    source: single("harness"),
    since: date ? date[2] : undefined,
  };
}

function useSignedOut(error: Error | null, onSignedOut: () => void) {
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
    <>
      <div className="heading">
        <div>
          <h1>Sessions</h1>
        </div>
      </div>
      <nav className="tabs" aria-label="Sessions views">
        {(["sessions", "search", "activity"] as const).map((name) => (
          <a
            key={name}
            href={listHref(query, name)}
            aria-current={tab === name ? "page" : undefined}
            onClick={onLinkClick}
          >
            {name === "sessions"
              ? "Sessions"
              : name === "search"
                ? "Search messages"
                : "Activity"}
          </a>
        ))}
      </nav>
      <SearchBox query={query} onChange={setQuery} tab={tab} />
      {tab === "sessions" && (
        <SessionList
          workspaceId={workspaceId}
          query={debounced}
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
        />
      )}
    </>
  );
}

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
    <div className="search">
      <input
        type="search"
        aria-label="Search sessions"
        placeholder={
          tab === "search"
            ? "Search prompts, replies, and tool output…"
            : "Search sessions, or filter with harness: project: is: person: updated:"
        }
        value={query}
        onChange={(event) => onChange(event.target.value)}
      />
      {filters.length > 0 && (
        <ul className="chips" aria-label="Active filters">
          {filters.map((filter) => (
            <li key={filter.raw}>
              <button
                type="button"
                aria-label={`Remove filter ${filter.raw}`}
                onClick={() => onChange(removeSessionFilter(query, filter.raw))}
              >
                {filter.raw} ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterBar({
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
  const suggestions = sessionSuggestions(rows, members, now);
  const options = (field: string) =>
    suggestions.filter((suggestion) => suggestion.field === field);
  const select = (field: string, label: string) => (
    <label>
      <span>{label}</span>
      <select
        value={filterValue(query, field)}
        onChange={(event) =>
          onQuery(setSessionFilter(query, field, event.target.value || null))
        }
      >
        <option value="">Any</option>
        {options(field).map((option) => (
          <option key={option.value} value={option.value}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="filters">
      {select("harness", "Agent")}
      {select("project", "Project")}
      {select("person", "Person")}
      {select("is", "Status")}
      {select("updated", "Updated")}
    </div>
  );
}

function StatusBadge({ row, now }: { row: SessionRow; now: number }) {
  const key = sessionActivity(row, now);
  return (
    <span
      className={`status status-${key}`}
      title={workStates[key].description}
    >
      {workStates[key].label}
    </span>
  );
}

function SessionList({
  workspaceId,
  query,
  onQuery,
  onSignedOut,
}: {
  workspaceId: string;
  query: string;
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
  const [moreError, setMoreError] = useState<Error | null>(null);
  const filters = useMemo(() => serverFilters(query), [query]);
  const key = JSON.stringify([workspaceId, filters, reload]);
  const page = useLoad(key, (signal) =>
    listSessions(workspaceId, filters, null, signal),
  );
  useSignedOut(page.error, onSignedOut);
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
  const members = page.data?.members ?? [];
  const cursor = extra ? extra.nextCursor : (page.data?.nextCursor ?? null);
  const now = page.data?.now
    ? Date.parse(page.data.now)
    : Date.parse(new Date().toISOString());
  const busy = page.loading || moreBusy;
  const error = page.error ?? moreError;

  async function loadMore() {
    if (!cursor || busy) return;
    setMoreBusy(true);
    setMoreError(null);
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
      setMoreError(reason as Error);
    } finally {
      setMoreBusy(false);
    }
  }

  const visible = rows.filter((row) => matchesSessionFilters(row, query, now));
  return (
    <>
      <div className="list-actions">
        <FilterBar
          rows={rows}
          members={members}
          query={query}
          onQuery={onQuery}
          now={now}
        />
        <button onClick={() => setReload((value) => value + 1)} disabled={busy}>
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error.message}</p>}
      {busy && rows.length === 0 && !error && (
        <p role="status">Loading sessions…</p>
      )}
      {!busy && !error && visible.length === 0 && (
        <p>
          {rows.length
            ? "No sessions match these filters."
            : "No sessions yet."}
        </p>
      )}
      {visible.length > 0 && (
        <div className="table-scroll">
          <table className="session-table">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Project</th>
                <th scope="col">Agent</th>
                <th scope="col">People</th>
                <th scope="col">Status</th>
                <th scope="col">Events</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={sessionKey(row)}>
                  <td className="session-cell">
                    <a
                      href={sessionHref(
                        row.sessionId,
                        row.source,
                        null,
                        listState(query, "sessions"),
                      )}
                      onClick={onLinkClick}
                    >
                      {sessionTitle(row)}
                    </a>
                    {row.parentSessionIds.length > 0 && (
                      <span className="tag">Subagent</span>
                    )}
                    {row.childSessionCount > 0 && (
                      <span className="tag">
                        {row.childSessionCount}{" "}
                        {row.childSessionCount === 1 ? "subagent" : "subagents"}
                      </span>
                    )}
                    {row.search?.snippet && (
                      <span className="snippet">{row.search.snippet}</span>
                    )}
                  </td>
                  <td>{projectName(row) ?? "—"}</td>
                  <td>
                    <span className="harness">
                      <i
                        style={{ background: toolColor(row.source) }}
                        aria-hidden="true"
                      />
                      {harnessName(row.source)}
                    </span>
                  </td>
                  <td>
                    {row.userIds.length
                      ? memberNames(row.userIds, members).join(", ")
                      : "—"}
                  </td>
                  <td>
                    <StatusBadge row={row} now={now} />
                  </td>
                  <td>{row.eventCount ?? "—"}</td>
                  <td>
                    <time dateTime={row.lastTs ?? undefined}>
                      {shortDate(row.lastTs)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <button
          className="more"
          onClick={() => void loadMore()}
          disabled={busy}
        >
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
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
  useSignedOut(page.error, onSignedOut);
  const [appended, setAppended] = useState<{
    key: string;
    matches: SearchMatch[];
    nextCursor: string | null;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<Error | null>(null);
  const extra = appended && appended.key === key ? appended : null;
  const matches = [...(page.data?.matches ?? []), ...(extra?.matches ?? [])];
  const members = page.data?.members ?? [];
  const cursor = extra ? extra.nextCursor : (page.data?.nextCursor ?? null);
  const busy = page.loading || moreBusy;
  const error = page.error ?? moreError;

  async function loadMore() {
    if (!cursor || !key) return;
    setMoreBusy(true);
    setMoreError(null);
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
      setMoreError(reason as Error);
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
      {error && <p role="alert">{error.message}</p>}
      {busy && matches.length === 0 && <p role="status">Searching…</p>}
      {!busy && !error && matches.length === 0 && <p>No messages match.</p>}
      <ul className="matches">
        {matches.map((match) => {
          const href = citationHref(
            match.citationPath,
            match.eventId,
            listState(query, "search"),
          );
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
                  {[who, match.toolName, match.taskTitle, match.projectId]
                    .filter(Boolean)
                    .join(" · ")}
                  <time dateTime={match.ts}>{shortDate(match.ts)}</time>
                </span>
                <span className="snippet">
                  {match.content ?? "(no text)"}
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
