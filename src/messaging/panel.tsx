import { useEffect, useState, type FormEvent } from "react";
import { getAccount, SignedOut } from "../api/client";
import {
  ensurePerson,
  listPeople,
  MessagingSignedOut,
  readConversation,
  sendMessage,
} from "./api";

type Person = { userId: string; displayName: string; handle: string; name: string };
type Message = { clientMessageId: string; text: string };

export function MessagingPanel() {
  const [signedOut, setSignedOut] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (caught instanceof SignedOut || caught instanceof MessagingSignedOut) setSignedOut(true);
        else if (!controller.signal.aborted) setError("Couldn’t load messages.");
      }
    })();
    return () => controller.abort();
  }, []);

  async function open(person: Person) {
    if (!workspaceId) return;
    setSelected(person);
    setError(null);
    try {
      const thread = await readConversation(workspaceId, person.name);
      setMessages(thread.messages);
    } catch (caught) {
      if (caught instanceof MessagingSignedOut) setSignedOut(true);
      else setError("Couldn’t open that conversation.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !selected || !draft.trim()) return;
    const clientMessageId = `ui-${crypto.randomUUID()}`;
    setError(null);
    try {
      const sent = await sendMessage(workspaceId, selected.name, draft.trim(), clientMessageId);
      setMessages((current) => current.some((message) => message.clientMessageId === sent.message.clientMessageId)
        ? current
        : [...current, sent.message]);
      setDraft("");
    } catch (caught) {
      if (caught instanceof MessagingSignedOut) setSignedOut(true);
      else setError("Couldn’t send that message.");
    }
  }

  if (signedOut) {
    return <p>Sign in to message people. <a href="/login">Sign in</a></p>;
  }
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
          <ol>
            {messages.map((message) => <li key={message.clientMessageId}>{message.text}</li>)}
          </ol>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Message
              <input value={draft} onChange={(event) => setDraft(event.target.value)} />
            </label>
            <button type="submit">Send</button>
          </form>
        </div>
      )}
    </section>
  );
}
