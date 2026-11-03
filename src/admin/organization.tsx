import { useState, type FormEvent } from "react";
import { adminApi } from "./api";
import type { AdminContext } from "./contracts";
import { CopyField } from "./connections";
import { message, useLoad } from "./use-load";

export function WorkspaceSection(props: { context: AdminContext }) {
  const { currentOrganization: org, currentWorkspace: workspace } =
    props.context;
  const { data, error } = useLoad((signal) =>
    adminApi.workspaces(org.id, signal),
  );
  return (
    <section aria-labelledby="workspace-title" className="card">
      <h2 id="workspace-title">Workspace</h2>
      <dl className="facts">
        <dt>Name</dt>
        <dd>{workspace.name}</dd>
        <dt>Workspace ID</dt>
        <dd>
          <CopyField value={workspace.id} label="workspace ID" />
        </dd>
        <dt>Your role</dt>
        <dd>{org.role}</dd>
      </dl>
      {error && <p role="alert">{message(error)}</p>}
      {data && data.length > 1 && (
        <>
          <h3>All workspaces in {org.name}</h3>
          <ul className="plain">
            {data.map((item) => (
              <li key={item.id}>
                {item.name} <code>{item.id}</code>
                {item.id === workspace.id && " (current)"}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function OrganizationSection(props: {
  context: AdminContext;
  canManage: boolean;
  onRenamed: () => void;
}) {
  const org = props.context.currentOrganization;
  const [name, setName] = useState(org.name);
  const [notice, setNotice] = useState<{
    kind: "status" | "alert";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await adminApi.renameOrganization(org.id, name.trim());
      setNotice({ kind: "status", text: "Organization renamed." });
      props.onRenamed();
    } catch (error) {
      setNotice({ kind: "alert", text: message(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="organization-title" className="card">
      <h2 id="organization-title">Organization</h2>
      <dl className="facts">
        <dt>Organization ID</dt>
        <dd>
          <CopyField value={org.id} label="organization ID" />
        </dd>
      </dl>
      {props.canManage ? (
        <form className="inline-form" onSubmit={(event) => void submit(event)}>
          <label>
            Name
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <button
            className="primary"
            type="submit"
            disabled={busy || !name.trim() || name.trim() === org.name}
          >
            Rename
          </button>
        </form>
      ) : (
        <dl className="facts">
          <dt>Name</dt>
          <dd>{org.name}</dd>
        </dl>
      )}
      {notice && <p role={notice.kind}>{notice.text}</p>}
    </section>
  );
}
