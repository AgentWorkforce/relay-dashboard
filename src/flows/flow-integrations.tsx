// Just-in-time integrations for a flow (hosted: the flow deploy wizard's
// integrations step). The integrations a flow source declares are listed with
// their status; a missing one connects from here, through the provider's OAuth
// with the self-host callback, and the callback page returns to this page.
// A provider whose OAuth app the operator has not configured shows the
// administrator message instead of a button.
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "../admin/api";
import type { IntegrationProvider } from "../admin/contracts";
import { message } from "../admin/use-load";
import { flowEffectHelperProviders, requiredFlowIntegrations } from "./flow-source-requirements";

export function requiredIntegrationIds(source: string): string[] {
  try {
    // Header tools and mounts, f.human recipients, and helpers used only in the
    // body (f.slack.post without a header flag).
    return requiredFlowIntegrations({
      source,
      sources: [],
      repositoryRequired: false,
      requirements: { integrations: flowEffectHelperProviders(source) },
    }).map((entry) => entry.provider);
  } catch {
    return [];
  }
}

export function FlowIntegrations({ source }: { source: string }) {
  const required = useMemo(() => requiredIntegrationIds(source), [source]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [providers, setProviders] = useState<IntegrationProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  // Set synchronously so a double click cannot start two attempts before the
  // disabled buttons render.
  const pending = useRef(false);
  // Bumped when the required set changes: a connect started before then is stale.
  const attempt = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function fetchStatus(signal?: AbortSignal) {
    const context = await adminApi.context(signal);
    const view = await adminApi.integrationProviders(context.currentWorkspace.id, signal);
    return { workspaceId: context.currentWorkspace.id, providers: view.providers };
  }
  function apply(result: { workspaceId: string; providers: IntegrationProvider[] }) {
    setWorkspaceId(result.workspaceId);
    setProviders(result.providers);
  }
  async function refreshProviders(workspace: string) {
    try {
      const view = await adminApi.integrationProviders(workspace);
      if (mounted.current) setProviders(view.providers);
    } catch {
      // The next tick retries.
    }
  }

  const requiredKey = required.join(",");
  useEffect(() => {
    if (!requiredKey) return;
    const controller = new AbortController();
    fetchStatus(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) apply(result);
      },
      (failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      },
    );
    return () => {
      controller.abort();
      // Invalidate any in-flight connect and its poll; nothing is left to
      // reset the pending state, so clear it here.
      attempt.current += 1;
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
      pending.current = false;
      setConnecting(null);
    };
  }, [requiredKey]);

  if (!required.length) return null;

  async function connect(provider: IntegrationProvider) {
    // One connect at a time: the pending label, the poll timer and the
    // providers refresh track a single attempt.
    if (!workspaceId || pending.current) return;
    pending.current = true;
    const mine = ++attempt.current;
    setError(null);
    setConnecting(provider.id);
    // Open synchronously so popup blockers allow it, then navigate it.
    // Per-attempt window name: a stale attempt's close() never reaches the
    // window a newer attempt is using.
    const popup = window.open("", `agent-relay-connect-${mine}`, "width=640,height=760");
    if (popup) popup.opener = null;
    try {
      const session = await adminApi.connectIntegration(workspaceId, provider.id, window.location.href);
      // Left the page, or the flow's integrations changed, while the session
      // was being created: start nothing.
      if (!mounted.current || attempt.current !== mine) {
        popup?.close();
        if (attempt.current === mine) pending.current = false;
        return;
      }
      if (popup) popup.location.href = session.connectLink;
      else window.location.assign(session.connectLink);
      // Refresh only the providers list while the provider window is open
      // (bounded to 10 minutes), then once more when it closes.
      let ticks = 0;
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        ticks += 1;
        const done = !popup || popup.closed || ticks > 200;
        void refreshProviders(workspaceId);
        if (done && timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
          pending.current = false;
          setConnecting(null);
        }
      }, 3_000);
    } catch (failure) {
      popup?.close();
      if (!mounted.current || attempt.current !== mine) return;
      pending.current = false;
      setConnecting(null);
      setError(message(failure));
    }
  }

  return (
    <section className="panel" aria-label="Integrations this flow uses">
      <h2>Integrations</h2>
      <p className="note">This flow uses these integrations. Connect any that are missing before it runs.</p>
      <ul className="integrations">
        {required.map((id) => {
          const provider = providers?.find((entry) => entry.id === id) ?? null;
          const ready = provider?.connection?.status === "ready";
          return (
            <li key={id} data-testid={`flow-integration-${id}`}>
              <strong>{provider?.displayName ?? id}</strong>{" "}
              {!providers ? (
                <span className="muted">Checking…</span>
              ) : !provider ? (
                <span className="muted">Not available on this installation</span>
              ) : ready ? (
                <span className="ok">Connected</span>
              ) : !provider.configured ? (
                <span role="note" className="muted">
                  {provider.adminMessage ??
                    `Your administrator needs to configure the ${provider.displayName} app before it can be connected.`}
                </span>
              ) : provider.authMode === "OAUTH2" ? (
                <button type="button" disabled={connecting !== null} onClick={() => void connect(provider)}>
                  {connecting === id ? "Waiting for authorization…" : `Connect ${provider.displayName}`}
                </button>
              ) : (
                <span className="muted">Connect with the CLI: agent-relay cloud integration connect {id}</span>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
