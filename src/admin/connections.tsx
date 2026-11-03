import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi } from "./api";
import type { Provider } from "./contracts";
import { formatDate, message, useLoad } from "./use-load";

type Notice = { kind: "status" | "alert"; text: string } | null;

export function ConnectionsSection(props: { workspaceId: string }) {
  const { data, error, reload } = useLoad((signal) =>
    adminApi.providers(props.workspaceId, signal),
  );
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const popup = useRef<Window | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  /**
   * Refreshes while the provider window is open (bounded to 10 minutes),
   * then once more when it closes.
   */
  function watchPopup(provider: Provider) {
    if (timer.current !== null) window.clearInterval(timer.current);
    let ticks = 0;
    const maxTicks = (10 * 60_000) / 2_000;
    timer.current = window.setInterval(() => {
      ticks += 1;
      const closed = !popup.current || popup.current.closed;
      if (closed || ticks > maxTicks) {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        reload();
        setNotice({
          kind: "status",
          text: `Finished connecting ${provider.displayName}? The list below shows the current status.`,
        });
        return;
      }
      reload();
    }, 2_000);
  }

  async function connect(provider: Provider) {
    setNotice(null);
    // Open synchronously so popup blockers allow it, then navigate it.
    const opened = window.open(
      "",
      "agent-relay-connect",
      "width=640,height=760",
    );
    // The provider's pages must not be able to navigate this tab.
    if (opened) opened.opener = null;
    try {
      const session = await adminApi.connectSession(
        props.workspaceId,
        provider.id,
      );
      // Left the page while the session was being created: don't start work.
      if (!mounted.current) {
        opened?.close();
        return;
      }
      if (opened) {
        opened.location.href = session.connectLink;
        popup.current = opened;
        watchPopup(provider);
      } else {
        window.location.assign(session.connectLink);
      }
    } catch (failure) {
      opened?.close();
      setNotice({ kind: "alert", text: message(failure) });
    }
  }

  async function disconnect(provider: Provider) {
    setNotice(null);
    try {
      await adminApi.disconnect(props.workspaceId, provider.id);
      setNotice({
        kind: "status",
        text: `Disconnected ${provider.displayName}.`,
      });
      reload();
    } catch (failure) {
      setNotice({ kind: "alert", text: message(failure) });
    }
  }

  const providers = (data?.providers ?? []).filter((provider) =>
    `${provider.displayName} ${provider.id} ${provider.categories?.join(" ") ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <section aria-labelledby="connections-title" className="card">
      <h2 id="connections-title">Connections</h2>
      <p>
        Connect the providers your agents and Flows use. Self-hosted connections
        use your own OAuth app for each provider; tokens are encrypted and only
        released to runtime services.
      </p>
      {data && (
        <div className="callout">
          <span>OAuth callback URL to register in each provider app</span>
          <CopyField value={data.redirectUri} label="OAuth callback URL" />
        </div>
      )}
      <input
        className="search"
        type="search"
        placeholder="Search providers…"
        aria-label="Search providers"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {notice && <p role={notice.kind}>{notice.text}</p>}
      {error && <p role="alert">{message(error)}</p>}
      {data && !data.canManage && (
        <p className="note">
          Only organization owners and admins can connect or configure
          providers.
        </p>
      )}
      <div className="provider-grid">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            canManage={data?.canManage ?? false}
            workspaceId={props.workspaceId}
            onChanged={reload}
            onConnect={() => void connect(provider)}
            onDisconnect={() => void disconnect(provider)}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderCard(props: {
  provider: Provider;
  canManage: boolean;
  workspaceId: string;
  onChanged: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { provider } = props;
  const [panel, setPanel] = useState<"none" | "oauth" | "apikey">("none");
  const [confirming, setConfirming] = useState(false);
  const connection = provider.connection;
  const connected = connection?.status === "ready";
  const oauth = provider.authMode === "OAUTH2";

  return (
    <article className="provider" aria-label={provider.displayName}>
      <header>
        <h3>{provider.displayName}</h3>
        <span
          className={`badge ${connected ? "ok" : connection ? "error" : ""}`}
        >
          {connected
            ? "Connected"
            : connection
              ? "Needs attention"
              : "Disconnected"}
        </span>
      </header>
      {provider.description && <p>{provider.description}</p>}
      <dl>
        {provider.configKey && (
          <>
            <dt>Provider config</dt>
            <dd>
              <code>{provider.configKey}</code>
            </dd>
          </>
        )}
        <dt>Auth</dt>
        <dd>{oauth ? "OAuth" : "API key"}</dd>
        {oauth && (
          <>
            <dt>OAuth app</dt>
            <dd>
              {provider.oauthApp
                ? `Client ${provider.oauthApp.clientId}`
                : "Not configured"}
            </dd>
          </>
        )}
        {connection?.accountLabel && (
          <>
            <dt>Account</dt>
            <dd>{connection.accountLabel}</dd>
          </>
        )}
        {connection && (
          <>
            <dt>Connected on</dt>
            <dd>{formatDate(connection.connectedAt)}</dd>
          </>
        )}
      </dl>
      {connection?.lastError && (
        <p role="alert">
          {connection.lastError}. Reconnect {provider.displayName} to fix it.
        </p>
      )}
      {props.canManage && (
        <div className="row">
          {oauth ? (
            <>
              <button
                className="primary"
                disabled={!provider.oauthApp}
                title={
                  provider.oauthApp
                    ? undefined
                    : "Configure the OAuth app first"
                }
                onClick={props.onConnect}
              >
                {connection ? "Reconnect" : "Connect"}
              </button>
              <button
                onClick={() => setPanel(panel === "oauth" ? "none" : "oauth")}
              >
                {provider.oauthApp ? "Edit OAuth app" : "Configure OAuth app"}
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => setPanel(panel === "apikey" ? "none" : "apikey")}
            >
              {connection ? "Replace key" : "Connect"}
            </button>
          )}
          {connection &&
            (confirming ? (
              <>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirming(false);
                    props.onDisconnect();
                  }}
                >
                  Confirm disconnect
                </button>
                <button onClick={() => setConfirming(false)}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)}>Disconnect</button>
            ))}
        </div>
      )}
      {panel === "oauth" && (
        <OAuthAppForm
          provider={provider}
          workspaceId={props.workspaceId}
          onSaved={() => {
            setPanel("none");
            props.onChanged();
          }}
        />
      )}
      {panel === "apikey" && (
        <ApiKeyForm
          provider={provider}
          workspaceId={props.workspaceId}
          onSaved={() => {
            setPanel("none");
            props.onChanged();
          }}
        />
      )}
    </article>
  );
}

function OAuthAppForm(props: {
  provider: Provider;
  workspaceId: string;
  onSaved: () => void;
}) {
  const { provider } = props;
  const [clientId, setClientId] = useState(provider.oauthApp?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(
    (provider.oauthApp?.scopes ?? provider.defaultScopes ?? []).join(" "),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const list = scopes.split(/[\s,]+/).filter(Boolean);
    const defaults = provider.defaultScopes ?? [];
    const isDefault =
      list.length === defaults.length &&
      list.every((scope, i) => scope === defaults[i]);
    try {
      await adminApi.putOAuthApp(props.workspaceId, provider.id, {
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        scopes: isDefault ? null : list,
      });
      props.onSaved();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <p className="note">
        Create an OAuth app
        {provider.appSetupUrl && (
          <>
            {" "}
            at{" "}
            <a href={provider.appSetupUrl} target="_blank" rel="noreferrer">
              {new URL(provider.appSetupUrl).host}
            </a>
          </>
        )}{" "}
        with the callback URL above, then paste its credentials.
      </p>
      <label>
        Client ID
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          autoComplete="off"
          required
        />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          placeholder={
            provider.oauthApp
              ? `Saved (${provider.oauthApp.clientSecretMasked}); leave blank to keep`
              : ""
          }
          autoComplete="new-password"
          required={!provider.oauthApp}
        />
      </label>
      {(provider.defaultScopes?.length ?? 0) > 0 && (
        <label>
          Scopes
          <input
            value={scopes}
            onChange={(event) => setScopes(event.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      {failure && <p role="alert">{failure}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          Save OAuth app
        </button>
      </div>
    </form>
  );
}

function ApiKeyForm(props: {
  provider: Provider;
  workspaceId: string;
  onSaved: () => void;
}) {
  const fields = props.provider.credentialFields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const credentials = Object.fromEntries(
      Object.entries(values)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value),
    );
    try {
      await adminApi.connectApiKey(
        props.workspaceId,
        props.provider.id,
        credentials,
      );
      props.onSaved();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          {!field.required && " (optional)"}
          <input
            type={field.secret ? "password" : "text"}
            placeholder={field.placeholder}
            required={field.required}
            autoComplete={field.secret ? "new-password" : "off"}
            value={values[field.key] ?? ""}
            onChange={(event) =>
              setValues({ ...values, [field.key]: event.target.value })
            }
          />
        </label>
      ))}
      {failure && <p role="alert">{failure}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  );
}

export function CopyField(props: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy">
      <code>{props.value}</code>
      <button
        type="button"
        aria-label={`Copy ${props.label}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(props.value)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
