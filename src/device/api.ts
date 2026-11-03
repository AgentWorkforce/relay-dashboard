import { z } from "zod";

/**
 * The human half of the device flow (RFC 8628 §3.3), against relaycontrol's
 * `POST /cloud/api/v1/auth/device/approve` with the dashboard session cookie.
 * Mirrors hosted Cloud's `/device` page: look the code up, show which client
 * and machine is asking and the workspace it will reach, then commit.
 */

export const APPROVE_ENDPOINT = "/cloud/api/v1/auth/device/approve";

export const deviceLookupSchema = z.object({
  user_code: z.string(),
  client_name: z.string().nullable(),
  desktop_host_name: z.string().nullable(),
  status: z.enum(["pending", "approved", "denied", "expired", "consumed"]),
  expires_at: z.string(),
  current_workspace_id: z.string().nullish(),
  workspaces: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        organization_name: z.string().nullable(),
      }),
    )
    .default([]),
});
export type DeviceLookup = z.infer<typeof deviceLookupSchema>;

export class DeviceSignedOut extends Error {}
export class DeviceError extends Error {
  constructor(
    message: string,
    /** relaycontrol's error code, when the server gave one. */
    readonly code = "",
  ) {
    super(message);
  }
}

/** Refusals after which the code can no longer be approved or denied. */
export const FINAL_ERRORS = new Set(["not_found", "expired", "already_decided"]);

const MESSAGES: Record<string, string> = {
  not_found: "That code was not found.",
  expired: "That code has expired. Start a new sign-in on the device.",
  already_decided: "That code was already used.",
  not_member: "You are not a member of that workspace.",
  workspace_not_found: "You can only approve for your current workspace.",
  device_approve_rate_limited: "Too many attempts. Wait a few minutes and try again.",
  csrf_rejected: "This page could not verify the request. Reload and try again.",
};

async function post(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(APPROVE_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new DeviceSignedOut();
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!response.ok) {
    const code = payload?.error ?? "";
    throw new DeviceError(
      MESSAGES[code] ?? payload?.message ?? "That request failed. Try again.",
      code,
    );
  }
  return payload;
}

export const deviceApi = {
  lookup: async (userCode: string) => {
    const parsed = deviceLookupSchema.safeParse(
      await post({ action: "lookup", user_code: userCode }),
    );
    if (!parsed.success)
      throw new DeviceError("The sign-in server sent an unexpected response. Try again.");
    return parsed.data;
  },
  decide: async (action: "approve" | "deny", userCode: string) => {
    await post({ action, user_code: userCode });
  },
};

/** `XXXX-XXXX`, or null for anything that cannot be a code. */
export function normalizeUserCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** `#/device?user_code=…` → the code the page was opened with. */
export function userCodeFromHash(hash: string): string {
  const query = hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("user_code") ?? "";
}

export function displayClientName(clientName: string | null): string {
  if (clientName === "Agent Relay Probe") return "Agent Relay Session Recorder";
  return clientName?.trim() || "Unidentified app or device";
}

export function approvalName(lookup: DeviceLookup): string {
  return lookup.desktop_host_name
    ? `Agent Relay Desktop on ${lookup.desktop_host_name}`
    : displayClientName(lookup.client_name);
}

export function workspaceLabel(lookup: DeviceLookup): string | null {
  // Only a single workspace may stand in for a missing current workspace;
  // with several, guessing could name the wrong one.
  const workspace =
    lookup.workspaces.find((item) => item.id === lookup.current_workspace_id) ??
    (lookup.workspaces.length === 1 ? lookup.workspaces[0] : undefined);
  if (!workspace) return null;
  const organization = workspace.organization_name?.trim();
  if (!organization || workspace.name === organization) return workspace.name;
  if (/^default(?: workspace)?$/i.test(workspace.name.trim())) return organization;
  return `${workspace.name} (${organization})`;
}
