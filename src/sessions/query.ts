// Search tokens, ported from the hosted dashboard's session-query.ts:
// `harness:`, `project:`, `is:`, `person:`, `updated:`, `created:`, with a
// leading `-` to negate. Free text goes to RelayHistory; tokens filter rows.
import type { ListFilters } from "./api";
import {
  harnessName,
  harnessSources,
  projectLabel,
  sessionActivity,
  toolKey,
  tools,
  type Member,
  type SessionRow,
} from "./data";

export type SessionFilter = {
  raw: string;
  field: string;
  value: string;
  exclude: boolean;
};

const PARTS = /(?:[^\s"]|"[^"]*")+/g;

export function parseSessionQuery(query: string) {
  const filters: SessionFilter[] = [];
  const words: string[] = [];
  for (const raw of query.match(PARTS) ?? []) {
    const match = raw.match(
      /^(-?)(harness|project|is|person|updated|created):(.*)$/i,
    );
    if (!match) {
      words.push(raw);
      continue;
    }
    filters.push({
      raw,
      field: match[2]!.toLowerCase(),
      value: match[3]!.replace(/^"|"$/g, ""),
      exclude: !!match[1],
    });
  }
  return { filters, text: words.join(" ") };
}

export function removeSessionFilter(query: string, token: string) {
  const parts: string[] = query.match(PARTS) ?? [];
  const index = parts.indexOf(token);
  if (index >= 0) parts.splice(index, 1);
  return parts.join(" ");
}

/**
 * Compare a row date with an `updated:`/`created:` value. `null` means the
 * value is still being typed (rows stay visible); a row without a valid date
 * never matches a complete value, as on the hosted dashboard.
 */
export function compareDate(stamp: string | null, value: string) {
  const match = value.match(/^(>=|<=|>|<|=)?(\d{4}-\d{2}-\d{2})$/);
  if (!match || !Number.isFinite(Date.parse(match[2]!))) return null;
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return false;
  const date = new Date(stamp).toISOString().slice(0, 10);
  const day = match[2]!;
  switch (match[1]) {
    case ">=":
      return date >= day;
    case "<=":
      return date <= day;
    case ">":
      return date > day;
    case "<":
      return date < day;
    default:
      return date === day;
  }
}

export function matchesSessionFilters(
  row: SessionRow,
  query: string,
  now: number,
) {
  return parseSessionQuery(query).filters.every(({ field, value, exclude }) => {
    const v = value.toLowerCase();
    if (!v) return true;
    let matches: boolean | null = false;
    switch (field) {
      case "harness":
        matches =
          row.source.toLowerCase() === v ||
          toolKey(row.source) === v ||
          harnessName(row.source).toLowerCase() === v;
        break;
      case "project":
        matches = [
          row.projectId,
          row.project?.name,
          projectLabel(row)?.name,
          projectLabel(row)?.detail,
        ].some((name) => projectMatches(name, v));
        break;
      case "person":
        matches = row.userIds.includes(value);
        break;
      case "is":
        matches =
          v === "inactive"
            ? sessionActivity(row, now) !== "active"
            : sessionActivity(row, now) === v;
        break;
      case "updated":
        matches = compareDate(row.lastTs, value);
        break;
      case "created":
        matches = compareDate(row.firstTs, value);
        break;
    }
    // An incomplete date is still being typed; don't hide rows for it.
    if (matches === null) return true;
    return exclude ? !matches : matches;
  });
}

export type SearchSuggestion = {
  field: string;
  value: string;
  title: string;
  section: string;
};

export const suggestionToken = (s: SearchSuggestion) =>
  `${s.field}:${/\s/.test(s.value) ? JSON.stringify(s.value) : s.value}`;

export function sessionSuggestions(
  rows: SessionRow[],
  members: Member[],
  now: number,
): SearchSuggestion[] {
  // Aliased sources (claude-terminal, claude-code) share one harness entry.
  const sources = new Set([
    ...Object.keys(tools),
    ...rows.map((row) => toolKey(row.source)),
  ]);
  return [
    ...[...sources].sort().map((value) => ({
      field: "harness",
      value,
      title: harnessName(value),
      section: "Harnesses",
    })),
    ...(["active", "idle", "finished"] as const).map((value) => ({
      field: "is",
      value,
      title: value[0]!.toUpperCase() + value.slice(1),
      section: "Status",
    })),
    // The value is the project id the server matches exactly; the title is
    // the label the table shows.
    ...[
      ...new Map(
        rows.flatMap((row) => {
          const label = projectLabel(row)?.name;
          const value = row.projectId || label;
          return value ? [[value, label ?? value] as const] : [];
        }),
      ),
    ]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, title]) => ({
        field: "project",
        value,
        title,
        section: "Projects",
      })),
    ...members.map((member) => ({
      field: "person",
      value: member.id,
      title: member.name || "Unknown teammate",
      section: "People",
    })),
    ...[1, 7, 30].map((days) => ({
      field: "updated",
      value:
        ">=" +
        new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10),
      title: days === 1 ? "Today" : `Last ${days} days`,
      section: "Updated",
    })),
  ];
}

/**
 * A project token names a project exactly: its full id or label, or its last
 * path segment (`project:relay` for `acme/relay`), never a prefix of another
 * name (`docs` does not select `docs-site`).
 */
export function projectMatches(name: string | null | undefined, value: string) {
  if (!name) return false;
  const candidate = name.toLowerCase().replace(/\/+$/, "");
  const wanted = value.toLowerCase().replace(/\/+$/, "");
  return (
    candidate === wanted ||
    candidate.endsWith(`/${wanted}`) ||
    candidate.split("/").at(-1) === wanted
  );
}

/** Replace any existing token for a single-valued field, then add this one. */
export function setSessionFilter(
  query: string,
  field: string,
  value: string | null,
) {
  const parts = (query.match(PARTS) ?? []).filter((part) => {
    const filter = parseSessionQuery(part).filters[0];
    return !filter || filter.field !== field || filter.exclude;
  });
  if (value) {
    parts.push(suggestionToken({ field, value, title: "", section: "" }));
  }
  return parts.join(" ");
}

export function filterValue(query: string, field: string): string {
  return (
    parseSessionQuery(query).filters.find(
      (filter) => filter.field === field && !filter.exclude,
    )?.value ?? ""
  );
}

/** Fields each non-list view can honour; other tokens are listed as unused. */
export const VIEW_FIELDS: Record<"search" | "activity", Set<string>> = {
  search: new Set(["harness", "project", "person", "updated"]),
  activity: new Set(),
};

/** Apply the search view's filter tokens to message matches. */
export function matchesSearchFilters(
  match: {
    source: string | null;
    projectId: string | null;
    userId: string | null;
    ts: string;
  },
  query: string,
) {
  return parseSessionQuery(query).filters.every(({ field, value, exclude }) => {
    const v = value.toLowerCase();
    if (!v || !VIEW_FIELDS.search.has(field)) return true;
    let matches: boolean | null = false;
    switch (field) {
      case "harness":
        matches =
          !!match.source &&
          (match.source.toLowerCase() === v ||
            toolKey(match.source) === v ||
            harnessName(match.source).toLowerCase() === v);
        break;
      case "project":
        matches = projectMatches(match.projectId, v);
        break;
      case "person":
        matches = match.userId === value;
        break;
      case "updated":
        matches = compareDate(match.ts, value);
        break;
    }
    if (matches === null) return true;
    return exclude ? !matches : matches;
  });
}

/**
 * Server-side filters derived from the query tokens: free text, dates, a
 * single unaliased harness, and a project only when the value is a project
 * id the dashboard has seen (every sidebar pick is one), because RelayHistory
 * matches `projectId` exactly. Labels and short names such as `relay` are
 * filtered in the browser. The sidebar's facet options and counts come from
 * the same query without project and harness (`facetFilters`), so a pick
 * never removes the other options.
 */
export function serverFilters(
  q: string,
  knownProjects: ReadonlySet<string> = new Set(),
) {
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
  const date = updated?.value.match(/^(>=|<=|>|<|=)?(\d{4}-\d{2}-\d{2})$/);
  const op = date?.[1] ?? "=";
  const day = date?.[2];
  // `until` is a superset bound (the next midnight); rows are still filtered
  // exactly in the browser.
  const nextDay =
    day && Number.isFinite(Date.parse(day))
      ? new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10)
      : undefined;
  const harness = single("harness");
  const project = single("project");
  return {
    q: parsed.text.trim() || undefined,
    // A harness with aliased sources (claude, claude-terminal…) is filtered in
    // the browser so the server doesn't drop the aliases.
    source:
      harness && harnessSources(harness).length === 1 ? harness : undefined,
    project: project && isProjectId(project, knownProjects) ? project : undefined,
    since: day && (op === ">=" || op === ">" || op === "=") ? day : undefined,
    until: day && (op === "<=" || op === "<" || op === "=") ? nextDay : undefined,
  };
}

/** A value RelayHistory can match exactly: a `projectId` seen in a page. */
function isProjectId(value: string, known: ReadonlySet<string>) {
  return known.has(value);
}

/** The list query without the sidebar's own facets, for options and counts. */
export function facetFilters(filters: ListFilters): ListFilters {
  return { ...filters, source: undefined, project: undefined };
}
