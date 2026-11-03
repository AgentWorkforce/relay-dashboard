// Search tokens, ported from the hosted dashboard's session-query.ts:
// `harness:`, `project:`, `is:`, `person:`, `updated:`, `created:`, with a
// leading `-` to negate. Free text goes to RelayHistory; tokens filter rows.
import {
  harnessName,
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

function compareDate(stamp: string | null, value: string) {
  const match = value.match(/^(>=|<=|>|<|=)?(\d{4}-\d{2}-\d{2})$/);
  if (!match || !stamp || !Number.isFinite(Date.parse(stamp))) return null;
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
        ].some((name) => name?.toLowerCase().includes(v));
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
  const sources = new Set([
    ...Object.keys(tools),
    ...rows.map((row) => row.source),
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
    ...[
      ...new Set(
        rows
          .map((row) => projectLabel(row)?.name)
          .filter((value): value is string => !!value),
      ),
    ]
      .sort()
      .map((value) => ({
        field: "project",
        value,
        title: value,
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
