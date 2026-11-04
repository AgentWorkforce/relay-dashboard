// Port of AgentWorkforce/cloud packages/web/app/dashboard/_components/connect-agent-dialog.tsx.
// Same markup and CSS module. Self-host differences: radix Dialog becomes a
// fixed overlay with the same classes; the Claude path is the hosted setup-token
// panel; every other provider takes an API key, because self-host has no
// `agent-relay cloud connect` CLI target and the stock flows worker cannot
// mount the Codex/Grok device-login files.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "../shell/ui";
import { adminApi } from "./api";
import type { CodingAgentProvider } from "./contracts";
import { message } from "./use-load";
import s from "./connect-agent-dialog.module.css";

const brandIcons: Record<string, string> = {
  google: "gemini",
  anthropic: "claude",
  openai: "codex",
  xai: "grok",
  opencode: "opencode",
};

/** One entry in the agent picker. */
export type ConnectChoice = {
  key: string;
  provider: string;
  label: string;
  kind: "setup-token" | "api-key";
  cli?: string;
  envName: string;
  keyPlaceholder?: string;
  docsUrl?: string;
};

/** Hosted CONNECT_COMMANDS order: Claude first, then the API-key providers. */
export function connectChoices(providers: CodingAgentProvider[]): ConnectChoice[] {
  const choices: ConnectChoice[] = [];
  for (const provider of providers) {
    if (provider.authTypes.includes("oauth_token")) {
      choices.push({
        key: `${provider.id}:setup-token`,
        provider: provider.id,
        label: "Claude",
        kind: "setup-token",
        cli: "claude",
        envName: "CLAUDE_CODE_OAUTH_TOKEN",
      });
    }
  }
  for (const provider of providers) {
    if (!provider.authTypes.includes("byo_api_key")) continue;
    choices.push({
      key: `${provider.id}:api-key`,
      provider: provider.id,
      label: provider.authTypes.includes("oauth_token")
        ? `${provider.displayName} API key`
        : provider.displayName,
      kind: "api-key",
      envName: provider.envName,
      keyPlaceholder: provider.keyPlaceholder,
      docsUrl: provider.docsUrl,
    });
  }
  return choices;
}

/** Host for the "Open …" link; null for a missing or malformed URL. */
function docsHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.host : null;
  } catch {
    return null;
  }
}

function iconUrl(icon: string) {
  return `${import.meta.env.BASE_URL}onboarding-icons/${icon}.svg`;
}

/** A command the operator runs in a terminal, with its own copy affordance. */
function CommandSnippet({ command }: { command: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <>
      <div className={s.command}>
        <code>{command}</code>
      </div>
      <button type="button" className={s.copy} onClick={() => void copy()}>
        {copyState === "copied" ? <Check size={16} /> : <Copy size={16} />}
        {copyState === "copied" ? "Copied" : "Copy command"}
      </button>
      {copyState === "error" ? (
        <p role="alert">Couldn’t copy. Select and copy the command above.</p>
      ) : null}
    </>
  );
}

function AgentIcon({ provider }: { provider: string }) {
  const icon = brandIcons[provider];
  if (icon) return <img src={iconUrl(icon)} width={32} height={32} alt="" />;
  return <Bot size={30} aria-hidden="true" />;
}

export function ConnectAgentDialog({
  open,
  onClose,
  choices,
  workspaceId,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  choices: ConnectChoice[];
  workspaceId: string;
  onConnected?: () => void;
}) {
  const [choiceKey, setChoiceKey] = useState<string | null>(null);
  const selected = choices.find((choice) => choice.key === choiceKey) ?? null;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  function reset() {
    setChoiceKey(null);
  }
  function close() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setChoiceKey(null);
        onClose();
        return;
      }
      // Keep Tab inside the dialog while it is open (radix Dialog does this on hosted).
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const titleId = "connect-agent-title";
  const descriptionId = "connect-agent-description";
  return (
    <>
      <div className={s.overlay} onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <button
          type="button"
          className={s.close}
          aria-label="Close connect agent dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
        {selected ? (
          <button type="button" className={s.back} onClick={reset}>
            <ArrowLeft size={15} /> All agents
          </button>
        ) : null}
        <div className={s.heading}>
          {selected ? (
            <span className={s.agentIcon}>
              <AgentIcon provider={selected.provider} />
            </span>
          ) : null}
          <div>
            <h2 id={titleId} className={s.title}>
              {selected ? `Connect ${selected.label}` : "Connect an agent"}
            </h2>
            <p id={descriptionId} className={s.description}>
              {!selected
                ? "Which agent would you like to connect?"
                : `Connect your ${selected.label} account from this browser.`}
            </p>
          </div>
        </div>
        {!selected ? (
          <div className={s.grid}>
            {choices.map((choice) => (
              <button
                type="button"
                key={choice.key}
                className={s.choice}
                onClick={() => setChoiceKey(choice.key)}
              >
                <span className={s.agentIcon}>
                  <AgentIcon provider={choice.provider} />
                </span>
                <span>{choice.label}</span>
                <ArrowRight size={16} className={s.arrow} />
              </button>
            ))}
            {!choices.length ? (
              <p className={s.description}>No agents are available to connect.</p>
            ) : null}
          </div>
        ) : selected.kind === "setup-token" ? (
          <SetupTokenPanel
            key={selected.key}
            label={selected.label}
            cli={selected.cli ?? "claude"}
            workspaceId={workspaceId}
            onConnected={onConnected}
            onDone={close}
          />
        ) : (
          <ApiKeyPanel
            key={selected.key}
            choice={selected}
            workspaceId={workspaceId}
            onConnected={onConnected}
            onDone={close}
          />
        )}
      </div>
    </>
  );
}

type PanelState = "idle" | "connecting" | "connected";

/**
 * Claude has no device flow, so the browser-only path is a `claude setup-token`
 * the operator pastes. The optional account email is what makes several Claude
 * subscriptions tellable apart in the credential list.
 */
function SetupTokenPanel({
  label,
  cli,
  workspaceId,
  onConnected,
  onDone,
}: {
  label: string;
  cli: string;
  workspaceId: string;
  onConnected?: () => void;
  onDone: () => void;
}) {
  const [token, setToken] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [error, setError] = useState<string | null>(null);
  const connecting = state === "connecting";

  async function connect() {
    setState("connecting");
    setError(null);
    try {
      await adminApi.putAgentSetupToken(workspaceId, {
        token: token.trim(),
        ...(accountEmail.trim() ? { accountEmail: accountEmail.trim() } : {}),
      });
      setToken("");
      setState("connected");
      onConnected?.();
    } catch (failure) {
      setState("idle");
      setError(message(failure));
    }
  }

  return (
    <>
      <ol className={s.steps} aria-label="Connection steps">
        <li aria-current={state !== "connected" && !token ? "step" : undefined}>
          <span>1</span> Generate a token
        </li>
        <li aria-current={state !== "connected" && token ? "step" : undefined}>
          <span>2</span> Paste it here
        </li>
      </ol>
      <section className={s.instructions} aria-live="polite">
        {state === "connected" ? (
          <>
            <h3>{label} connected</h3>
            <p>
              This workspace can now run {label} agents with your subscription
              {accountEmail.trim() ? ` (${accountEmail.trim()})` : ""}. The token is
              stored encrypted on your control plane as a workspace credential.
            </p>
          </>
        ) : (
          <>
            <h3>Paste your {label} setup token</h3>
            <p>Run this on your computer, then paste the token it prints.</p>
            <CommandSnippet command={`${cli} setup-token`} />
            <label className={s.field}>
              <span>Setup token</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste setup-token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <label className={s.field}>
              <span>
                Account email <em>(optional)</em>
              </span>
              <input
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="you@example.com"
                value={accountEmail}
                onChange={(event) => setAccountEmail(event.target.value)}
              />
              <small>
                Names which {label} account this token is for. A different email adds
                another account; the same email replaces that account’s token.
              </small>
            </label>
            <button
              type="button"
              className={s.action}
              disabled={connecting || !token.trim()}
              onClick={() => void connect()}
            >
              {connecting ? (
                <Loader2 size={16} className={s.spinner} aria-hidden="true" />
              ) : null}
              {connecting ? "Connecting…" : `Connect ${label}`}
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className={s.error}>
            {error}
          </p>
        ) : null}
      </section>
      <div className={s.footer}>
        <span />
        <Button className={s.primary} onClick={onDone}>
          {state === "connected" ? "Back to connections" : "Done"}
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}

/** Self-host addition in the setup-token panel's shape: paste a provider API key. */
function ApiKeyPanel({
  choice,
  workspaceId,
  onConnected,
  onDone,
}: {
  choice: ConnectChoice;
  workspaceId: string;
  onConnected?: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [error, setError] = useState<string | null>(null);
  const connecting = state === "connecting";

  async function connect() {
    setState("connecting");
    setError(null);
    try {
      await adminApi.putAgentApiKey(workspaceId, {
        modelProvider: choice.provider,
        key: key.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setKey("");
      setState("connected");
      onConnected?.();
    } catch (failure) {
      setState("idle");
      setError(message(failure));
    }
  }

  return (
    <>
      <ol className={s.steps} aria-label="Connection steps">
        <li aria-current={state !== "connected" && !key ? "step" : undefined}>
          <span>1</span> Create a key
        </li>
        <li aria-current={state !== "connected" && key ? "step" : undefined}>
          <span>2</span> Paste it here
        </li>
      </ol>
      <section className={s.instructions} aria-live="polite">
        {state === "connected" ? (
          <>
            <h3>{choice.label} connected</h3>
            <p>
              Flow runs in this workspace receive this key as {choice.envName} while it
              has LLM call access. The key is stored encrypted on your control plane and
              is never shown again.
            </p>
          </>
        ) : (
          <>
            <h3>Paste your {choice.label} key</h3>
            <p>
              Create a key in your {choice.label} account, then paste it here.
            </p>
            {choice.docsUrl && docsHost(choice.docsUrl) ? (
              <a
                className={s.deviceLink}
                href={choice.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open {docsHost(choice.docsUrl)}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
            <label className={s.field}>
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={choice.keyPlaceholder ?? "Paste API key"}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <label className={s.field}>
              <span>
                Label <em>(optional)</em>
              </span>
              <input
                type="text"
                autoComplete="off"
                maxLength={80}
                placeholder={`${choice.label} production`}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <small>Tells several keys for the same provider apart.</small>
            </label>
            <button
              type="button"
              className={s.action}
              disabled={connecting || !key.trim()}
              onClick={() => void connect()}
            >
              {connecting ? (
                <Loader2 size={16} className={s.spinner} aria-hidden="true" />
              ) : null}
              {connecting ? "Connecting…" : `Connect ${choice.label}`}
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className={s.error}>
            {error}
          </p>
        ) : null}
      </section>
      <div className={s.footer}>
        <span />
        <Button className={s.primary} onClick={onDone}>
          {state === "connected" ? "Back to connections" : "Done"}
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}
