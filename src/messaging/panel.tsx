import { useEffect, useRef, useState, type FormEvent } from "react";
import { getAccount, SignedOut } from "../api/client";
import { loginHref, redirectBrowser } from "../app-path";
import {
  ensurePerson,
  listPeople,
  MessagingRequestError,
  MessagingSignedOut,
  readConversation,
  sendMessage,
} from "./api";

const MAX_MESSAGE_CHARS = 16_000;

type Person = { userId: string; displayName: string; handle: string; name: string };
type Message = { id: string | null; clientMessageId?: string; text: string; mine: boolean };
type PendingSend = { id: string; text: string };

function threadKey(workspaceId: string, recipient: string): string {
  return `${workspaceId}:${recipient}`;
}

export function MessagingPanel() {
  const [signedOut, setSignedOut] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingThread, setSendingThread] = useState<string | null>(null);
  const generation = useRef(0);
  const selectedRef = useRef<Person | null>(null);
  const inFlightThreads = useRef(new Set<string>());
  const pending = useRef(new Map<string, PendingSend>());
  const drafts = useRef<Record<string, string>>({});

  useEffect(() => {
    if (signedOut) redirectBrowser(loginHref());
  }, [signedOut]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const account = await getAccount(controller.signal);
        const workspace = account.currentWorkspace?.id;
        if (!workspace) {
          setError("No workspace is selected.");
          return;
        }
        setWorkspaceId(workspace);
        await ensurePerson(workspace, controller.signal);
        const directory = await listPeople(workspace, controller.signal);
        setPeople(directory.people.filter((person) => person.userId !== account.user?.id));
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof SignedOut || caught instanceof MessagingSignedOut) setSignedOut(true);
        else setError("Couldn’t load messages.");
      }
    })();
    return () => controller.abort();
  }, []);

  function rememberDraft(value: string, person: Person | null, workspace: string | null) {
    setDraft(value);
    if (workspace && person) drafts.current[threadKey(workspace, person.name)] = value;
  }

  async function open(person: Person) {
    if (!workspaceId) return;
    if (selected) drafts.current[threadKey(workspaceId, selected.name)] = draft;
    const gen = ++generation.current;
    selectedRef.current = person;
    setSelected(person);
    setMessages([]);
    setError(null);
    setLoading(true);
    const restored = drafts.current[threadKey(workspaceId, person.name)] ?? "";
    setDraft(restored);
    try {
      const thread = await readConversation(workspaceId, person.name);
      if (gen !== generation.current) return;
      setMessages(thread.messages);
    } catch (caught) {
      if (gen !== generation.current) return;
      setMessages([]);
      if (caught instanceof MessagingSignedOut) setSignedOut(true);
      else setError("Couldn’t open that conversation.");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || !workspaceId || !selected) return;
    const key = threadKey(workspaceId, selected.name);
    if (inFlightThreads.current.has(key)) return;
    const typed = draft.trim();
    if (!typed) return;
    if (typed.length > MAX_MESSAGE_CHARS) {
      setError(`Messages must be 1–${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    // Same text keeps the uncertain id. A different draft is a new message.
    const existing = pending.current.get(key);
    const op: PendingSend = existing && existing.text === typed
      ? existing
      : { id: `ui-${crypto.randomUUID()}`, text: typed };
    pending.current.set(key, op);
    const gen = generation.current;
    const recipient = selected.name;
    inFlightThreads.current.add(key);
    setSendingThread(key);
    setError(null);
    try {
      const sent = await sendMessage(workspaceId, recipient, op.text, op.id);
      pending.current.delete(key);
      const draftWasSent = (drafts.current[key] ?? "").trim() === op.text;
      if (draftWasSent) drafts.current[key] = "";
      const stillHere = selectedRef.current?.name === recipient;
      if (draftWasSent && stillHere) setDraft("");
      if (gen !== generation.current || !stillHere) return;
      setMessages((current) => current.some((message) => message.id && message.id === sent.message.id)
        ? current
        : [...current, sent.message]);
    } catch (caught) {
      if (gen !== generation.current || selectedRef.current?.name !== recipient) return;
      if (caught instanceof MessagingSignedOut) {
        setSignedOut(true);
        return;
      }
      if (caught instanceof MessagingRequestError && caught.code === "recipient_not_found") {
        pending.current.delete(key);
        setError("No one by that name is on the relay.");
        return;
      }
      if (caught instanceof MessagingRequestError && caught.code === "send_uncertain") {
        setError("The relay did not confirm the message. It may have been delivered. Sending again will not send it twice.");
        return;
      }
      setError("Couldn’t send that message.");
    } finally {
      inFlightThreads.current.delete(key);
      setSendingThread((current) => current === key ? null : current);
    }
  }

  if (signedOut) return <p>Redirecting to sign in.</p>;
  return (
    <section aria-label="Messages">
      {error && <p role="alert">{error}</p>}
      <ul>
        {people.map((person) => (
          <li key={person.userId}>
            <button type="button" onClick={() => void open(person)}>
              {person.displayName} {person.handle}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div>
          <h2>{selected.displayName}</h2>
          {loading && <p>Loading conversation.</p>}
          <ol>
            {messages.map((message, index) => (
              <li key={message.id ?? message.clientMessageId ?? `${index}`}>{message.text}</li>
            ))}
          </ol>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Message
              <textarea
                value={draft}
                maxLength={MAX_MESSAGE_CHARS}
                onChange={(event) => rememberDraft(event.target.value, selected, workspaceId)}
              />
            </label>
            <p>Messages can be up to {MAX_MESSAGE_CHARS} characters.</p>
            <button type="submit" disabled={loading || sendingThread === threadKey(workspaceId ?? "", selected.name)}>Send</button>
          </form>
        </div>
      )}
    </section>
  );
}
