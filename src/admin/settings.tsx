import { useEffect, useState } from "react";
import { adminApi, canManage, SignedOut } from "./api";
import { CodingAgentsSection } from "./coding-agents";
import { ConnectionsSection } from "./connections";
import { DesktopSection } from "./desktop";
import { EnvironmentSection } from "./environment";
import { MembersSection } from "./members";
import { OrganizationSection, WorkspaceSection } from "./organization";
import { TokensSection } from "./tokens";
import { useLoad } from "./use-load";
import "./admin.css";
import { loginHref } from "../app-path";
import {
  Blocks,
  Building2,
  KeyRound,
  LockKeyhole,
  Plug,
  Search,
  SunMoon,
  Users2,
} from "lucide-react";
import { ThemeSelector } from "../shell/theme-selector";
import { Button, Skeleton } from "../shell/ui";
import s from "./settings.module.css";

/** Hosted settings-layout.tsx sections, minus billing/development. */
export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", group: "Preferences", adminOnly: false, icon: SunMoon },
  { id: "workspace", label: "Workspace", group: "Workspace", adminOnly: false, icon: Building2 },
  { id: "connections", label: "Connections", group: "Workspace", adminOnly: false, icon: Plug },
  // Self-host only: hosted keeps Nango integrations off the settings page.
  // Self-host's bring-your-own OAuth integrations live here instead.
  { id: "integrations", label: "Integrations", group: "Workspace", adminOnly: false, icon: Blocks },
  { id: "tokens", label: "API tokens", group: "Workspace", adminOnly: true, icon: KeyRound },
  { id: "environment", label: "Environment", group: "Workspace", adminOnly: false, icon: LockKeyhole },
  { id: "organization", label: "Organization", group: "Organization", adminOnly: false, icon: Building2 },
  { id: "members", label: "Members", group: "Organization", adminOnly: false, icon: Users2 },
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const DESCRIPTIONS: Record<SettingsSectionId, string> = {
  appearance: "Make Relay feel right for you.",
  workspace: "Your workspace and the agents connected to it.",
  connections: "Coding agents and model accounts available to your workspace.",
  integrations: "GitHub, Slack, Linear and other tools your Flow runs can use.",
  tokens: "Keys that give your tools access to this workspace.",
  environment: "Encrypted variables and API keys your Flow runs receive.",
  organization: "Your organization’s identity and shared settings.",
  members: "The people who share this workspace.",
};

/** Hosted: a workspace still named "Default" is shown by its organization's name. */
function workspaceDisplayName(workspaceName: string, organizationName: string) {
  return /^default(?: workspace)?$/i.test(workspaceName.trim()) ? organizationName : workspaceName;
}

export function settingsHash(section: SettingsSectionId) {
  return `#/settings/${section}`;
}

export function Settings(props: { section: string }) {
  const {
    data: context,
    error,
    reload,
  } = useLoad((signal) => adminApi.context(signal));
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (error instanceof SignedOut) window.location.replace(loginHref());
  }, [error]);

  const manage = context ? canManage(context.currentOrganization.role) : false;
  const visible = SETTINGS_SECTIONS.filter((item) => manage || !item.adminOnly);
  const active =
    visible.find((item) => item.id === props.section)?.id ?? "workspace";
  const shown = visible.filter((item) =>
    item.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const groups = ["Preferences", "Workspace", "Organization"];
  // While the context loads, head the page with the requested section.
  const requested = SETTINGS_SECTIONS.find((item) => item.id === props.section);
  const heading = context ? active : (requested?.id ?? active);
  const activeLabel = SETTINGS_SECTIONS.find((item) => item.id === heading)?.label;

  return (
    <div className={`${s.page} settings`}>
      <div className={s.workspace}>
        <aside className={s.sidebar} aria-label="Settings navigation">
          <label className={s.search} data-slot="input-group">
            <Search size={15} aria-hidden="true" />
            <input
              data-slot="input-group-control"
              type="search"
              placeholder="Search settings…"
              aria-label="Search settings"
              className="bg-transparent outline-none placeholder:text-muted-foreground"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <nav className={s.tabs} aria-label="Settings">
            {groups.map((group) => {
              const items = shown.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div key={group} role="group" aria-label={`${group} settings`}>
                  <p className={s.groupLabel}>{group}</p>
                  {items.map(({ id, label, icon: Icon }) => (
                    <a
                      key={id}
                      href={settingsHash(id)}
                      className={s.tab}
                      data-state={id === active ? "active" : "inactive"}
                      aria-current={id === active ? "page" : undefined}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {label}
                    </a>
                  ))}
                </div>
              );
            })}
          </nav>
          {shown.length === 0 && (
            <p className={s.noResults} role="status">
              No settings found.
            </p>
          )}
        </aside>
        <div className={s.detail}>
          <header className={s.heading}>
            <h1>{activeLabel ?? "Settings"}</h1>
            <p>{DESCRIPTIONS[heading]}</p>
          </header>
          {error && !(error instanceof SignedOut) && (
            <p role="alert">
              {error.message}{" "}
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </p>
          )}
          {error instanceof SignedOut && (
            <p role="alert">Taking you to sign in…</p>
          )}
          {active === "appearance" && <ThemeSelector />}
          {active !== "appearance" && !context && !error && (
            <div role="status" aria-label="Loading settings…" className="flex flex-col gap-4">
              <span className="sr-only">Loading settings…</span>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {context && active !== "appearance" && (
            <div
              className={s.content}
              data-section={active}
            >
              {active === "workspace" && (
                <>
                  <WorkspaceSection context={context} />
                  <DesktopSection context={context} />
                </>
              )}
              {active === "connections" && (
                <CodingAgentsSection
                  key={context.currentWorkspace.id}
                  workspaceId={context.currentWorkspace.id}
                  workspaceName={workspaceDisplayName(
                    context.currentWorkspace.name,
                    context.currentOrganization.name,
                  )}
                />
              )}
              {active === "integrations" && (
                <ConnectionsSection workspaceId={context.currentWorkspace.id} />
              )}
              {active === "tokens" && manage && (
                <TokensSection workspaceId={context.currentWorkspace.id} />
              )}
              {active === "environment" && (
                <EnvironmentSection
                  workspaceId={context.currentWorkspace.id}
                  canManage={manage}
                />
              )}
              {active === "organization" && (
                <OrganizationSection
                  context={context}
                  canManage={manage}
                  onRenamed={reload}
                />
              )}
              {active === "members" && (
                <MembersSection
                  organizationId={context.currentOrganization.id}
                  organizationName={context.currentOrganization.name}
                  viewerRole={context.currentOrganization.role}
                  currentUserId={context.user.id}
                  canManage={manage}
                  onChanged={reload}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
