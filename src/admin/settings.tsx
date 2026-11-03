import { useEffect, useState } from "react";
import { adminApi, canManage, SignedOut } from "./api";
import { ConnectionsSection } from "./connections";
import { EnvironmentSection } from "./environment";
import { MembersSection } from "./members";
import { OrganizationSection, WorkspaceSection } from "./organization";
import { TokensSection } from "./tokens";
import { useLoad } from "./use-load";
import "./admin.css";
import { appPath, loginHref } from "../app-path";

/** Hosted settings-layout.tsx sections, minus billing/appearance/development. */
export const SETTINGS_SECTIONS = [
  { id: "workspace", label: "Workspace", group: "Workspace", adminOnly: false },
  {
    id: "connections",
    label: "Connections",
    group: "Workspace",
    adminOnly: false,
  },
  { id: "tokens", label: "API tokens", group: "Workspace", adminOnly: true },
  {
    id: "environment",
    label: "Environment",
    group: "Workspace",
    adminOnly: false,
  },
  {
    id: "organization",
    label: "Organization",
    group: "Organization",
    adminOnly: false,
  },
  { id: "members", label: "Members", group: "Organization", adminOnly: false },
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

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
  const groups = [...new Set(shown.map((item) => item.group))];

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
          <a href={settingsHash("workspace")} aria-current="page">
            Settings
          </a>
        </nav>
      </header>
      <main className="settings">
        <div className="heading">
          <div>
            <h1>Settings</h1>
            {context && (
              <p>
                {context.currentOrganization.name} ·{" "}
                {context.currentWorkspace.name}
              </p>
            )}
          </div>
        </div>
        {error && !(error instanceof SignedOut) && (
          <p role="alert">
            {error.message}{" "}
            <button type="button" onClick={reload}>
              Try again
            </button>
          </p>
        )}
        {error instanceof SignedOut && (
          <p role="alert">Taking you to sign in…</p>
        )}
        {!context && !error && <p role="status">Loading settings…</p>}
        {context && (
          <div className="settings-layout">
            <nav aria-label="Settings">
              <input
                type="search"
                placeholder="Search settings…"
                aria-label="Search settings"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {groups.map((group) => (
                <div key={group}>
                  <h4>{group}</h4>
                  {shown
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <a
                        key={item.id}
                        href={settingsHash(item.id)}
                        aria-current={item.id === active ? "page" : undefined}
                      >
                        {item.label}
                      </a>
                    ))}
                </div>
              ))}
            </nav>
            <div className="settings-panel">
              {active === "workspace" && <WorkspaceSection context={context} />}
              {active === "connections" && (
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
                  currentUserId={context.user.id}
                  canManage={manage}
                  onChanged={reload}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
