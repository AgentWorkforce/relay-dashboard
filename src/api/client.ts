import { accountSchema, sessionsSchema } from "./contracts";
export class SignedOut extends Error {}
async function read(path: string, signal: AbortSignal) {
  const response = await fetch(`/cloud/api${path}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok)
    throw new Error("Couldn’t load your sessions. Please try again.");
  return response.json();
}
export async function getAccount(signal: AbortSignal) {
  const body = await read("/auth/session?renew=0", signal);
  if (body?.authenticated === false) throw new SignedOut();
  return accountSchema.parse(body);
}
export async function getSessions(
  workspace: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ metadata: "deferred" });
  if (cursor) query.set("cursor", cursor);
  const page = sessionsSchema.parse(
    await read(
      `/v1/workspaces/${encodeURIComponent(workspace)}/sessions?${query}`,
      signal,
    ),
  );
  if (page.error)
    throw new Error(
      "Session history is temporarily unavailable. Please try again.",
    );
  return page;
}
