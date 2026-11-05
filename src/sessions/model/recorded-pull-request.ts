// Ported from Cloud session-table-data.ts; only recorded, valid GitHub PR references.
export function recordedPullRequest(refs: unknown): { url: string; number: string } | null {
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    if (!ref || typeof ref !== "object") continue;
    const raw = ref.url ?? ref.html_url ?? ref.pullRequestUrl;
    if (typeof raw !== "string") continue;
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)\/?$/);
      if (
        url.protocol === "https:" &&
        url.hostname === "github.com" &&
        !url.username &&
        !url.password &&
        match
      ) {
        return { url: url.origin + url.pathname, number: match[1] };
      }
    } catch {
      /* Ignore incomplete references. */
    }
  }
  return null;
}
