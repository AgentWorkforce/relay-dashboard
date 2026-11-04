// Port of hosted Settings > Connections > "Coding agents"
// (AgentWorkforce/cloud packages/web/app/dashboard/_components/dashboard-views.tsx
// `ConnectedHarnessesSection` and `DashboardPanel`), with the same markup and
// Tailwind classes.
//
// Self-host differences:
// - Credentials belong to the workspace, so every member sees every row (the
//   hosted owner view); owners/admins connect, select, check and disconnect.
// - No Agent Relay house key, so no "Agent Relay API key" option and no
//   OpenCode managed credential.
// - Sandbox access is a Claude setup token. Codex/Grok subscription logins are
//   not offered on self-host (the stock flows worker cannot mount them).
// - Each row also shows the masked key preview and the env var flow runs get.
import { useId, useState, type ReactNode } from "react";
import { Bot, ChevronDown, Plus, RefreshCcw, Terminal } from "lucide-react";
import { cn } from "../shell/cn";
import { Badge, Button } from "../shell/ui";
import { adminApi } from "./api";
import { ConnectAgentDialog, connectChoices } from "./connect-agent-dialog";
import type { CodingAgent, CodingAgentCheck } from "./contracts";
import { message, useLoad } from "./use-load";
import s from "./settings.module.css";

const CONNECTION_PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
};

/** Hosted `canonicalConnectionProvider`. */
export function canonicalConnectionProvider(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "openai" || normalized === "codex") return "openai";
  if (normalized === "xai" || normalized === "grok") return "xai";
  if (normalized === "google" || normalized === "gemini") return "google";
  return normalized;
}

/** Hosted `isHarnessSelectableAuthType`: subscription logins only. */
function isHarnessSelectableAuthType(authType: string) {
  return authType === "provider_oauth" || authType === "oauth_token";
}

function connectionProviderLabel(provider: string, agents: CodingAgent[]): string {
  return CONNECTION_PROVIDER_LABELS[provider] ?? agents[0]?.displayName ?? provider;
}

/** The one usable status. relaycontrol reports only `connected` and `error`. */
function isConnected(agent: Pick<CodingAgent, "status">): boolean {
  return agent.status === "connected";
}

/** Hosted dashboard-data `getAgentBadgeVariant`, keyed on the same predicate as selection. */
function getAgentBadgeVariant(agent: Pick<CodingAgent, "status">) {
  if (isConnected(agent)) return "success" as const;
  const normalized = agent.status.toLowerCase();
  if (["authorizing", "pending", "starting"].includes(normalized)) return "warning" as const;
  return "danger" as const;
}

/** Hosted dashboard-data `formatTimestamp`. */
function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function checkBadgeVariant(status: CodingAgentCheck["status"]) {
  if (status === "available") return "success" as const;
  if (status === "error") return "danger" as const;
  if (status === "unavailable") return "warning" as const;
  return "default" as const;
}

function credentialNeedsAttention(agent: Pick<CodingAgent, "lastError" | "status">): boolean {
  return Boolean(agent.lastError) || !isConnected(agent);
}

function credentialIdentity(agent: CodingAgent): string {
  return (
    agent.label?.trim() ||
    agent.accountEmail?.trim() ||
    agent.owner?.name?.trim() ||
    agent.displayName
  );
}

/**
 * Hosted `activeSandboxCredentialIds`: the explicit bit. The newest eligible
 * row is used only for responses that carry no `harnessActive` at all.
 */
function activeSandboxCredentialIds(agents: CodingAgent[]): Set<string> {
  const eligible = agents.filter(
    (agent) => isHarnessSelectableAuthType(agent.authType) && isConnected(agent),
  );
  if (eligible.some((agent) => agent.harnessActive !== undefined)) {
    return new Set(eligible.filter((agent) => agent.harnessActive).map((agent) => agent.id));
  }
  const chosen =
    [...eligible].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    )[0];
  return new Set(chosen ? [chosen.id] : []);
}

/** Hosted `DashboardPanel`. */
export function DashboardPanel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const contentId = useId();
  return (
    <section className={cn("min-w-0 border-t border-[var(--dashboard-border)] pt-5", className)}>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          <div className="text-sm text-[var(--text-secondary)]">{description}</div>
        </div>
        {actions ? <div className="min-w-0 w-full xl:w-auto">{actions}</div> : null}
      </header>
      <div id={contentId} className={cn("mt-5 flex min-w-0 flex-col gap-5", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

export function CodingAgentsSection(props: { workspaceId: string; workspaceName: string }) {
  const { data, error, reload } = useLoad((signal) => adminApi.codingAgents(props.workspaceId, signal));
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  // Per-credential pending sets: several rows can check or disconnect at once.
  const [checkingAgentIds, setCheckingAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [checkResults, setCheckResults] = useState<Record<string, CodingAgentCheck>>({});
  const [disconnectingAgentIds, setDisconnectingAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectingAgentId, setSelectingAgentId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Collapsed on every visit, as hosted.
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => new Set());

  const canManage = data?.canManage ?? false;
  const displayAgents = data?.agents ?? [];
  const connectedCount = displayAgents.length;
  // Anthropic and OpenAI stay in the list with no credential, as hosted.
  const providerIds = new Set(
    displayAgents.map((agent) => canonicalConnectionProvider(agent.modelProvider)),
  );
  providerIds.add("anthropic");
  providerIds.add("openai");
  const providerGroups = [...providerIds]
    .map((provider) => {
      const credentials = displayAgents.filter(
        (agent) => canonicalConnectionProvider(agent.modelProvider) === provider,
      );
      return {
        id: provider,
        label: connectionProviderLabel(provider, credentials),
        credentials,
        sandboxCredentialIds: activeSandboxCredentialIds(credentials),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const distinctProviders = providerGroups
    .filter((group) => group.credentials.length > 0)
    .map((group) => group.label);
  const needingAttentionCount = displayAgents.filter(credentialNeedsAttention).length;
  const allProvidersExpanded =
    providerGroups.length > 0 && providerGroups.every((group) => expandedProviders.has(group.id));
  const summaryHeadline = `${connectedCount} credential${connectedCount === 1 ? "" : "s"} connected across the workspace`;
  const summaryDetail = `${distinctProviders.join(", ")}${
    needingAttentionCount > 0
      ? ` • ${needingAttentionCount} need${needingAttentionCount === 1 ? "s" : ""} attention`
      : ""
  }`;

  const toggleProvider = (provider: string) => {
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };
  const toggleAllProviders = () => {
    setExpandedProviders(
      allProvidersExpanded ? new Set() : new Set(providerGroups.map((group) => group.id)),
    );
  };

  const setRowError = (agentId: string, text: string | null) =>
    setRowErrors((current) => {
      const next = { ...current };
      if (text) next[agentId] = text;
      else delete next[agentId];
      return next;
    });

  const withPending = (set: ReadonlySet<string>, id: string, pending: boolean) => {
    const next = new Set(set);
    if (pending) next.add(id);
    else next.delete(id);
    return next;
  };

  const checkAgent = async (agentId: string) => {
    if (checkingAgentIds.has(agentId)) return;
    setCheckingAgentIds((current) => withPending(current, agentId, true));
    try {
      const result = await adminApi.checkAgent(props.workspaceId, agentId);
      setCheckResults((current) => ({ ...current, [agentId]: result }));
    } catch (failure) {
      setCheckResults((current) => ({
        ...current,
        [agentId]: {
          status: "error",
          checkedAt: new Date().toISOString(),
          message: message(failure),
        },
      }));
    } finally {
      setCheckingAgentIds((current) => withPending(current, agentId, false));
      reload();
    }
  };

  const disconnectAgent = async (agentId: string) => {
    if (disconnectingAgentIds.has(agentId)) return;
    setDisconnectingAgentIds((current) => withPending(current, agentId, true));
    setRowError(agentId, null);
    try {
      await adminApi.deleteAgent(props.workspaceId, agentId);
    } catch (failure) {
      setRowError(agentId, message(failure));
    } finally {
      setDisconnectingAgentIds((current) => withPending(current, agentId, false));
      reload();
    }
  };

  // One selection at a time: the buttons stay disabled until the server has
  // answered, so rapid clicks cannot finish in a different order.
  const selectAgent = async (agentId: string, selection: "model" | "harness") => {
    if (selectingAgentId) return;
    setSelectingAgentId(agentId);
    setRowError(agentId, null);
    try {
      await adminApi.activateAgent(props.workspaceId, agentId, selection);
    } catch (failure) {
      setRowError(agentId, message(failure));
    } finally {
      setSelectingAgentId(null);
      reload();
    }
  };

  return (
    <>
      <DashboardPanel
        title="Coding agents"
        description={`Connect coding agents to ${props.workspaceName}.`}
        actions={
          canManage ? (
            <Button onClick={() => setConnectDialogOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Connect agent
            </Button>
          ) : null
        }
        className={s.connections}
        contentClassName="gap-5"
      >
        <div className={s.credentials}>
          {error ? (
            <div
              className="flex min-h-[16rem] items-center justify-center rounded-lg border border-dashed border-[var(--status-danger)] bg-card px-6 text-center text-sm text-[var(--status-danger)]"
              role="alert"
            >
              {error.message}{" "}
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : !data ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading coding agents…
            </p>
          ) : (
            <>
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-card p-4"
                data-testid="harness-credentials-summary"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{summaryHeadline}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {summaryDetail || "No credentials yet"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={allProvidersExpanded}
                  onClick={toggleAllProviders}
                  data-testid="harness-credentials-toggle"
                >
                  {allProvidersExpanded ? "Collapse all" : "Expand all"}
                </Button>
              </div>

              <div className="flex flex-col gap-3" data-testid="provider-credential-groups">
                {providerGroups.map((group) => {
                  const expanded = expandedProviders.has(group.id);
                  const providerNeedsAttention = group.credentials.some(credentialNeedsAttention);
                  const activeSandboxCredentials = group.credentials.filter((agent) =>
                    group.sandboxCredentialIds.has(agent.id),
                  );
                  const activeModelCredentials = group.credentials.filter(
                    (agent) => agent.isActive && isConnected(agent),
                  );
                  const credentialSupportsSandbox = group.credentials.some((agent) =>
                    isHarnessSelectableAuthType(agent.authType),
                  );
                  // An empty group whose provider offers a subscription login
                  // (Claude setup token, Codex or Grok device login) can still
                  // take one later. Do not call that "Not supported".
                  const catalogEntry = data.providers.find((provider) => provider.id === group.id);
                  const supportsSandbox =
                    credentialSupportsSandbox ||
                    (group.credentials.length === 0 &&
                      Boolean(
                        catalogEntry?.authTypes.some((type) => type === "oauth_token" || type === "provider_oauth"),
                      ));
                  const sandboxSummary = supportsSandbox
                    ? activeSandboxCredentials.map(credentialIdentity).join(", ") || "None selected"
                    : "Not supported";
                  const modelSummary =
                    activeModelCredentials.map(credentialIdentity).join(", ") || "None selected";

                  return (
                    <section
                      key={group.id}
                      className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-card"
                      data-testid={`provider-group-${group.id}`}
                    >
                      <div className="grid items-center gap-4 p-4 md:grid-cols-[minmax(8rem,0.8fr)_minmax(18rem,1.7fr)_auto]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium text-foreground">{group.label}</h3>
                            <Badge
                              variant={
                                providerNeedsAttention
                                  ? "warning"
                                  : group.credentials.length > 0
                                    ? "success"
                                    : "default"
                              }
                            >
                              {providerNeedsAttention
                                ? "Needs attention"
                                : group.credentials.length > 0
                                  ? "Connected"
                                  : "Not connected"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {group.credentials.length} credential
                            {group.credentials.length === 1 ? "" : "s"}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <Terminal
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">Sandbox access</p>
                              <p className="truncate text-sm text-foreground" title={sandboxSummary}>
                                {sandboxSummary}
                              </p>
                            </div>
                          </div>
                          <div className="flex min-w-0 items-start gap-2.5">
                            <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">LLM call access</p>
                              <p className="truncate text-sm text-foreground" title={modelSummary}>
                                {modelSummary}
                              </p>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label} credentials`}
                          aria-expanded={expanded}
                          onClick={() => toggleProvider(group.id)}
                          data-testid={`provider-group-${group.id}-toggle`}
                        >
                          <ChevronDown
                            className={cn("size-4 transition-transform", expanded && "rotate-180")}
                            aria-hidden="true"
                          />
                        </Button>
                      </div>

                      {expanded ? (
                        <div className="border-t border-[var(--border-default)]">
                          {group.credentials.length === 0 ? (
                            <p className="p-4 text-sm text-muted-foreground">
                              No {group.label} credentials yet.
                              {canManage ? " Use Connect agent to add one." : ""}
                            </p>
                          ) : null}
                          {group.credentials.map((agent) => {
                            const isSandboxCredential = group.sandboxCredentialIds.has(agent.id);
                            const sandboxCapable = isHarnessSelectableAuthType(agent.authType);
                            const sandboxEligible = sandboxCapable && isConnected(agent);
                            const checkResult = checkResults[agent.id];
                            const checking = checkingAgentIds.has(agent.id);
                            const disconnecting = disconnectingAgentIds.has(agent.id);
                            const rowError = rowErrors[agent.id];
                            const llmActive = agent.isActive;

                            // A Codex/Grok login is the CLI's auth file, not an API key.
                            const sandboxOnly = agent.authType === "provider_oauth";
                            const llmControl = sandboxOnly ? (
                              <span className="text-xs text-muted-foreground">Sandbox login only</span>
                            ) : llmActive ? (
                              <Badge variant={isConnected(agent) ? "success" : "warning"}>
                                {isConnected(agent) ? "Active" : "Unavailable"}
                              </Badge>
                            ) : isConnected(agent) && canManage ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={selectingAgentId !== null}
                                onClick={() => void selectAgent(agent.id, "model")}
                              >
                                Use for LLM calls
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unavailable</span>
                            );

                            return (
                              <article
                                key={agent.id}
                                data-testid={`harness-credential-${agent.id}`}
                                className={cn(
                                  "border-t border-[var(--border-default)] p-4 first:border-t-0",
                                  agent.lastError && "bg-[var(--status-danger-soft)]/20",
                                )}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium text-foreground">{credentialIdentity(agent)}</p>
                                      <Badge variant={getAgentBadgeVariant(agent)}>{agent.status}</Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {agent.accountEmail ? `${agent.accountEmail} • ` : ""}
                                      {agent.harness}
                                      {" • "}
                                      <code data-testid={`harness-preview-${agent.id}`}>{agent.secretPreview}</code>
                                    </p>
                                  </div>
                                </div>

                                {sandboxCapable ? (
                                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                                    <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-soft)] p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                                          <p className="text-sm font-medium text-foreground">Sandbox access</p>
                                        </div>
                                        {isSandboxCredential ? (
                                          <Badge variant="success">Active</Badge>
                                        ) : sandboxEligible && canManage ? (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={selectingAgentId !== null}
                                            onClick={() => void selectAgent(agent.id, "harness")}
                                          >
                                            Use for sandbox
                                          </Button>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">Unavailable</span>
                                        )}
                                      </div>
                                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                        {sandboxOnly
                                          ? `Mounts this account's ${agent.harness} login in flow runs (0600, deleted after the run).`
                                          : `Signs in ${agent.harness} in flow runs as CLAUDE_CODE_OAUTH_TOKEN.`}
                                      </p>
                                    </div>

                                    <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-soft)] p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
                                          <p className="text-sm font-medium text-foreground">LLM call access</p>
                                        </div>
                                        {llmControl}
                                      </div>
                                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                        Handles programmatic model requests from flows and ctx.llm.
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-soft)] px-3 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">LLM call access</p>
                                        <p className="text-xs text-muted-foreground">
                                          Model calls only · not a sandbox login
                                        </p>
                                      </div>
                                    </div>
                                    {llmControl}
                                  </div>
                                )}

                                <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      Authenticated
                                    </p>
                                    <p className="mt-1 truncate text-foreground">
                                      {formatTimestamp(agent.lastAuthenticatedAt)}
                                    </p>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      Last used
                                    </p>
                                    <p className="mt-1 truncate text-foreground">
                                      {formatTimestamp(agent.lastUsedAt)}
                                    </p>
                                  </div>
                                </div>

                                {agent.lastError ? (
                                  <div className="mt-4 rounded-md border border-[var(--status-danger)] bg-[var(--status-danger-soft)] p-3 text-sm text-[var(--status-danger)]">
                                    {agent.lastError}
                                  </div>
                                ) : null}

                                {checkResult ? (
                                  <div className="mt-4 flex items-start gap-2 text-sm" role="status">
                                    <Badge variant={checkBadgeVariant(checkResult.status)}>{checkResult.status}</Badge>
                                    <p className="min-w-0 leading-5 text-muted-foreground">{checkResult.message}</p>
                                  </div>
                                ) : null}

                                {rowError ? (
                                  <div
                                    className="mt-4 rounded-md border border-[var(--status-danger)] bg-[var(--status-danger-soft)] p-3 text-sm text-[var(--status-danger)]"
                                    role="alert"
                                  >
                                    {rowError}
                                  </div>
                                ) : null}

                                {canManage ? (
                                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={checking || disconnecting}
                                      onClick={() => void checkAgent(agent.id)}
                                    >
                                      <RefreshCcw data-icon="inline-start" className={cn(checking && "animate-spin")} />
                                      {checking ? "Checking" : "Check token"}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-[var(--status-danger)] hover:text-[var(--status-danger)]"
                                      disabled={disconnecting}
                                      onClick={() => {
                                        const confirmed = window.confirm(
                                          `Disconnect ${agent.displayName}? Future flow runs using this credential will stop authenticating on their next run. Already-running runs may keep their copy until they exit.`,
                                        );
                                        if (confirmed) void disconnectAgent(agent.id);
                                      }}
                                    >
                                      {disconnecting ? "Disconnecting" : "Disconnect"}
                                    </Button>
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </DashboardPanel>

      <ConnectAgentDialog
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
        choices={connectChoices(data?.providers ?? [])}
        workspaceId={props.workspaceId}
        onConnected={reload}
      />
    </>
  );
}
