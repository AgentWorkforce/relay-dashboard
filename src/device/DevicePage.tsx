import { useEffect, useRef, useState } from "react";
import { getAccount, SignedOut } from "../api/client";
import type { Account } from "../api/contracts";
import { appPath, loginHref } from "../app-path";
import {
  approvalName,
  deviceApi,
  DeviceSignedOut,
  displayClientName,
  normalizeUserCode,
  workspaceLabel,
  type DeviceLookup,
} from "./api";
import "./device.css";

/**
 * Authorize a device (hosted Cloud's `/device`). Two steps: look the code up
 * and show which app or machine is asking and which workspace it will reach,
 * then an explicit Approve or Deny. The confirmation step is the
 * anti-phishing control: a person sent here with someone else's code sees a
 * machine they do not recognize before anything is granted.
 */
export function DevicePage(props: {
  initialUserCode: string;
  /** Leaves for sign-in; replaceable in tests. */
  navigate?: (url: string) => void;
}) {
  const navigate = props.navigate ?? ((url: string) => window.location.replace(url));
  const [account, setAccount] = useState<Account | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [userCode, setUserCode] = useState(props.initialUserCode);
  const [lookup, setLookup] = useState<DeviceLookup | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoLookup = useRef(props.initialUserCode.trim().length > 0);

  useEffect(() => {
    const attempt = new AbortController();
    getAccount(attempt.signal)
      .then((value) => {
        if (!attempt.signal.aborted) setAccount(value);
      })
      .catch((reason: unknown) => {
        if (attempt.signal.aborted) return;
        if (reason instanceof SignedOut) setSignedOut(true);
        else setError("Couldn’t check your sign-in. Reload to try again.");
      });
    return () => attempt.abort();
  }, []);

  // Sign in first, then come back to this page with the same code.
  useEffect(() => {
    if (signedOut) navigate(loginHref());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut]);

  async function check(code: string) {
    const normalized = normalizeUserCode(code);
    if (!normalized) {
      setError("Enter the 8-character code shown in the app or device you’re connecting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await deviceApi.lookup(normalized);
      if (found.status !== "pending") {
        setError(
          found.status === "expired"
            ? "That code has expired. Start a new sign-in on the device."
            : "That code has already been used.",
        );
        return;
      }
      setUserCode(found.user_code);
      setLookup(found);
    } catch (reason) {
      if (reason instanceof DeviceSignedOut) setSignedOut(true);
      else setError(reason instanceof Error ? reason.message : "Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!account || !autoLookup.current) return;
    autoLookup.current = false;
    void check(props.initialUserCode);
    // Runs once, for the code the page was opened with, after sign-in is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  async function decide(action: "approve" | "deny") {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    try {
      await deviceApi.decide(action, lookup.user_code);
      setOutcome(action === "approve" ? "approved" : "denied");
    } catch (reason) {
      if (reason instanceof DeviceSignedOut) setSignedOut(true);
      else setError(reason instanceof Error ? reason.message : "Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const workspace = lookup ? workspaceLabel(lookup) : null;

  return (
    <div className="dashboard">
      <header>
        <a className="brand" href={appPath()}>
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" />
          <img
            className="wordmark"
            src={`${import.meta.env.BASE_URL}wordmark.svg`}
            alt="Agent Relay"
          />
        </a>
        <nav className="top-nav" aria-label="Primary">
          <a href={appPath()}>Sessions</a>
          <a href="#/flows">Flows</a>
          <a href="#/settings/workspace">Settings</a>
          {account && (
            <span>
              {[account.currentWorkspace?.name, account.user.name]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </nav>
      </header>
      <main className="device">
        <h1>Authorize a device</h1>
        <p>
          Connect an app or device to your Agent Relay workspace. Only approve a
          sign-in you started yourself.
        </p>
        <section className="device-card" aria-label="Device authorization">
          {signedOut && <p role="status">Taking you to sign in…</p>}
          {!signedOut && !account && !error && <p role="status">Checking your sign-in…</p>}

          {account && outcome && (
            <div role="status">
              <h2>{outcome === "approved" ? "Device approved" : "Device denied"}</h2>
              <p>
                {outcome === "approved"
                  ? `Return to ${lookup ? approvalName(lookup) : "the app or device where you started signing in"}. Sign-in will finish within a few seconds. You can close this tab.`
                  : "No credentials were issued. You can close this tab."}
              </p>
            </div>
          )}

          {account && !outcome && lookup && (
            <div>
              <p>Requesting app or device</p>
              <h2>{approvalName(lookup)}</h2>
              <dl>
                <dt>Code</dt>
                <dd>
                  <code>{lookup.user_code}</code>
                </dd>
                {lookup.desktop_host_name && (
                  <>
                    <dt>Client</dt>
                    <dd>{displayClientName(lookup.client_name)}</dd>
                  </>
                )}
                <dt>Workspace</dt>
                <dd>{workspace ?? "Your current workspace"}</dd>
                <dt>Expires</dt>
                <dd>
                  <time dateTime={lookup.expires_at}>
                    {new Date(lookup.expires_at).toLocaleTimeString()}
                  </time>
                </dd>
              </dl>
              <p>
                {lookup.desktop_host_name
                  ? `Approving authorizes Agent Relay Desktop on ${lookup.desktop_host_name} to access ${workspace ?? "your workspace"}. Check that this is the computer where you started sign-in; otherwise, deny it.`
                  : `Approving grants this app or device access to ${workspace ?? "your workspace"}. If you did not start this sign-in, deny it.`}
              </p>
              {error && <p role="alert">{error}</p>}
              <div className="device-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void decide("approve")}
                >
                  {busy ? "Working…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("deny")}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          {account && !outcome && !lookup && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void check(userCode);
              }}
            >
              <label htmlFor="user_code">Device code</label>
              <p id="device-code-help">
                Enter the code shown in the app or device you’re connecting.
              </p>
              <input
                id="user_code"
                name="user_code"
                aria-describedby="device-code-help"
                value={userCode}
                onChange={(event) => setUserCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX"
              />
              {error && <p role="alert">{error}</p>}
              <div className="device-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || userCode.trim().length === 0}
                >
                  {busy ? "Checking…" : "Continue"}
                </button>
              </div>
            </form>
          )}

          {!account && error && <p role="alert">{error}</p>}
        </section>
      </main>
    </div>
  );
}
