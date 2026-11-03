import { useState, type FormEvent } from "react";
import { adminApi } from "./api";
import type { TokenPurpose } from "./contracts";
import { CopyField } from "./connections";
import { formatDate, message, useLoad } from "./use-load";

const PURPOSES: Array<{ value: TokenPurpose; label: string; help: string }> = [
  {
    value: "agent-runtime",
    label: "Workspace API Key",
    help: "Lets a runtime service read this workspace's environment and connection tokens.",
  },
  {
    value: "workflow",
    label: "Flows token",
    help: "For a Flows worker: workflow scopes plus runtime reads. May never expire.",
  },
  {
    value: "deployment",
    label: "Deployment token",
    help: "For CI deployments.",
  },
];
const EXPIRY = ["30", "90", "180", "365"];

export function TokensSection(props: { workspaceId: string }) {
  const { data, error, reload } = useLoad((signal) =>
    adminApi.listTokens(props.workspaceId, signal),
  );
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState<TokenPurpose>("agent-runtime");
  const [expiry, setExpiry] = useState("90");
  const [created, setCreated] = useState<{
    label: string;
    token: string;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const help = PURPOSES.find((item) => item.value === purpose)?.help;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const token = await adminApi.createToken(props.workspaceId, {
        label: label.trim(),
        purpose,
        ...(expiry === "never"
          ? { neverExpires: true }
          : { expiryDays: Number(expiry) }),
      });
      setCreated({ label: token.label, token: token.accessToken });
      setLabel("");
      reload();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setFailure(null);
    try {
      await adminApi.revokeToken(props.workspaceId, id);
      reload();
    } catch (error) {
      setFailure(message(error));
    }
  }

  return (
    <section aria-labelledby="tokens-title" className="card">
      <h2 id="tokens-title">API tokens</h2>
      <p>
        Workspace tokens for services that act on this workspace. A token is
        shown once; store it in your secret manager.
      </p>
      <form className="inline-form" onSubmit={(event) => void submit(event)}>
        <label>
          Name
          <input
            value={label}
            maxLength={128}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="flows-worker"
            required
          />
        </label>
        <label>
          Purpose
          <select
            value={purpose}
            onChange={(event) => {
              const next = event.target.value as TokenPurpose;
              setPurpose(next);
              // "Never" only exists for workflow tokens.
              if (next !== "workflow" && expiry === "never") setExpiry("90");
            }}
          >
            {PURPOSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expires
          <select
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {EXPIRY.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
            {purpose === "workflow" && <option value="never">Never</option>}
          </select>
        </label>
        <button
          className="primary"
          type="submit"
          disabled={busy || !label.trim()}
        >
          Create token
        </button>
      </form>
      {help && <p className="note">{help}</p>}
      {created && (
        <div className="callout" role="status">
          <strong>
            Copy this token now. You won’t be able to see it again.
          </strong>
          <CopyField value={created.token} label={`token ${created.label}`} />
          <button onClick={() => setCreated(null)}>Done</button>
        </div>
      )}
      {failure && <p role="alert">{failure}</p>}
      {error && <p role="alert">{message(error)}</p>}
      {data && data.length === 0 && <p>No tokens yet.</p>}
      {data && data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Creator</th>
              <th>Purpose</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.map((token) => (
              <tr key={token.id}>
                <td>{token.label}</td>
                <td>
                  {token.createdBy?.name ?? token.createdBy?.email ?? "—"}
                </td>
                <td>
                  {PURPOSES.find((item) => item.value === token.purpose)
                    ?.label ?? token.purpose}
                </td>
                <td>{formatDate(token.createdAt)}</td>
                <td>
                  {token.accessTokenExpiresAt
                    ? formatDate(token.accessTokenExpiresAt)
                    : "Never"}
                </td>
                <td>{formatDate(token.lastUsedAt)}</td>
                <td>
                  <span
                    className={`badge ${token.status === "active" ? "ok" : ""}`}
                  >
                    {token.status}
                  </span>
                </td>
                <td className="actions">
                  {token.status === "active" && (
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Revoke token "${token.label}"? Services using it lose access.`,
                          )
                        )
                          void revoke(token.id);
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
