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
  clientMessageId: z.string(),
  text: z.string(),
  mine: z.literal(true),
  createdAt: z.string().optional(),
});
const threadSchema = z.object({
  you: z.string(),
  peer: z.string(),
  messages: z.array(messageSchema),
});
const sentSchema = z.object({
  you: z.string(),
  duplicate: z.boolean().optional(),
  message: messageSchema.omit({ createdAt: true }),
});

export class MessagingSignedOut extends Error {}

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
  if (!response.ok) throw new Error("Messaging request failed");
  return response.json();
}

function workspacePath(workspaceId: string, suffix: string): string {
  return `/cloud/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messaging/${suffix}`;
}

export async function listPeople(workspaceId: string, signal?: AbortSignal) {
  return peopleSchema.parse(await call(workspacePath(workspaceId, "people"), { signal }));
}

export async function ensurePerson(workspaceId: string, signal?: AbortSignal) {
  await call(workspacePath(workspaceId, "identity/credential"), { method: "POST", signal });
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
