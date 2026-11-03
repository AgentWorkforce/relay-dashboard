import { useState, type FormEvent } from "react";
import { adminApi } from "./api";
import { formatDate, message, useLoad } from "./use-load";

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function EnvironmentSection(props: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { data, error, reload } = useLoad((signal) =>
    adminApi.listEnv(props.workspaceId, signal),
  );
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const exists = Boolean(data?.some((row) => row.name === name.trim()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const key = name.trim();
    setFailure(null);
    setStatus(null);
    if (!NAME.test(key)) {
      setFailure(
        "Names start with a letter or underscore and use only letters, digits, and underscores.",
      );
      return;
    }
    if (!value) {
      setFailure("Enter a value.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.putEnv(props.workspaceId, key, value);
      setStatus(`${exists ? "Replaced" : "Added"} ${key}.`);
      setName("");
      setValue("");
      reload();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(key: string) {
    setBusy(true);
    setFailure(null);
    try {
      await adminApi.deleteEnv(props.workspaceId, key);
      setConfirming(null);
      setStatus(`Deleted ${key}.`);
      reload();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="environment-title" className="card">
      <h2 id="environment-title">Environment</h2>
      <p>
        Variables delivered to agents and Flow runs in this workspace, such as
        model provider keys like <code>ANTHROPIC_API_KEY</code>. Values are
        write-only: after saving, only a masked preview is shown.
      </p>
      {props.canManage ? (
        <form className="inline-form" onSubmit={(event) => void submit(event)}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="NATIVE_API_KEY"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Value
            <input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {exists ? "Replace" : "Add"}
          </button>
        </form>
      ) : (
        <p className="note">
          Only organization owners and admins can change environment variables.
        </p>
      )}
      {failure && <p role="alert">{failure}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error.message}</p>}
      {data && data.length === 0 && <p>No environment variables yet.</p>}
      {data && data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Updated</th>
              {props.canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.name}>
                <td>
                  <code>{row.name}</code>
                  {row.deliveredToFlowRuns === false && (
                    <span className="badge warn">
                      Reserved name: not delivered to Flow runs
                    </span>
                  )}
                </td>
                <td>
                  <code className="masked">{row.maskedValue}</code>
                </td>
                <td>{formatDate(row.updatedAt)}</td>
                {props.canManage && (
                  <td className="actions">
                    {confirming === row.name ? (
                      <>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => void remove(row.name)}
                        >
                          Confirm delete
                        </button>
                        <button onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirming(row.name)}>
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
