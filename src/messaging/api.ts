import { z } from "zod";

const person = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.string(),
  handle: z.string(),
  name: z.string(),
  photo: z.null(),
});
const peopleSchema = z.object({ people: z.array(person) });
const messageSchema = z.object({
  id: z.string().nullable(),
  clientMessageId: z.string().optional(),
  text: z.string(),
  mine: z.boolean(),
  sender: z.string().optional(),
  createdAt: z.string().nullable().optional(),
});
const threadSchema = z.object({
  you: z.string().nullable(),
  peer: z.string(),
  messages: z.array(messageSchema),
  earlier: z.string().nullable().optional(),
});
const sentSchema = z.object({
  you: z.string(),
  duplicate: z.boolean().optional(),
  message: messageSchema.omit({ createdAt: true }),
});

export class MessagingSignedOut extends Error {}

/** Status and stable code only. The response body can contain relay secrets. */
export class MessagingRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "MessagingRequestError";
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) throw new MessagingSignedOut();
  if (!response.ok) {
    let code = "request_failed";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        code = body.error;
      }
    } catch {
      // Ignore the body. It is not safe to surface.
    }
    throw new MessagingRequestError(response.status, code);
  }
  return response.json();
}

function workspacePath(workspaceId: string, suffix: string): string {
  return `/cloud/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messaging/${suffix}`;
}

export async function listPeople(workspaceId: string, signal?: AbortSignal) {
  return peopleSchema.parse(await call(workspacePath(workspaceId, "people"), { signal }));
}

export async function ensurePerson(workspaceId: string, signal?: AbortSignal) {
  await call(workspacePath(workspaceId, "identity/credential"), {
    method: "POST",
    body: "{}",
    signal,
  });
}

export async function readConversation(workspaceId: string, agentName: string, signal?: AbortSignal) {
  return threadSchema.parse(await call(
    workspacePath(workspaceId, `conversations/${encodeURIComponent(agentName)}`),
    { signal },
  ));
}

export async function sendMessage(workspaceId: string, agentName: string, text: string, clientMessageId: string) {
  return sentSchema.parse(await call(
    workspacePath(workspaceId, `conversations/${encodeURIComponent(agentName)}`),
    { method: "POST", body: JSON.stringify({ text, clientMessageId }) },
  ));
}
