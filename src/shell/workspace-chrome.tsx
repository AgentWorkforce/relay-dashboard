// Ported from hosted Cloud (app/dashboard/_components/workspace-chrome.tsx).
// Presentation only: every page keeps ownership of its data, state, and
// controls, and portals them into the heading, toolbar and sidebar slots.
// Self-host differences: hash/query links instead of Next routes, a simple
// drawer instead of the Radix Sheet, and no hosted-only views (Addresses).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Settings2,
  X,
} from "lucide-react";
import { appPath } from "../app-path";
import { BrandLockup } from "./brand";
import { branding } from "./branding";
import { cn } from "./cn";
import { FlowsIcon, SessionsIcon } from "./icons";
import { Button } from "./ui";
import { WorkspaceViewSlotsContext } from "./view-slots";
import airframe from "./dashboard-airframe.module.css";
import s from "./workspace-chrome.module.css";

export type RailSection = "Agents" | "Flows" | "Settings";

const compactQuery = "(max-width: 759px)";
function subscribeCompact(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(compactQuery);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}
function getCompact() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(compactQuery).matches
    : false;
}

const navigationPreferenceKey = "relay:workspace-navigation-collapsed";
function readNavigationPreference() {
  try {
    return window.localStorage.getItem(navigationPreferenceKey) === "true";
  } catch {
    return false;
  }
}
function subscribeNavigationPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("relay:navigation-preference", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("relay:navigation-preference", onChange);
  };
}

type ViewLink = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  rail: RailSection;
};

// A shared rail has more than one link. A session detail is still Sessions.
function viewIsCurrent(
  name: string,
  target: RailSection,
  rail: RailSection,
  label: string,
  views: readonly ViewLink[],
): boolean {
  if (rail !== target) return false;
  if (views.filter((view) => view.rail === target).length < 2) return true;
  return name === (label === "Session" ? "Sessions" : label);
}

export function WorkspaceChrome({
  children,
  rail,
  label,
  workspaceName,
  accountControl,
}: {
  children: ReactNode;
  rail: RailSection;
  /** The default topbar heading; pages may replace it through the heading slot. */
  label: string;
  workspaceName?: string;
  accountControl?: ReactNode;
}) {
  const persistedCollapsed = useSyncExternalStore(
    subscribeNavigationPreference,
    readNavigationPreference,
    () => false,
  );
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);
  const collapsed = localCollapsed ?? persistedCollapsed;
  function toggleNavigation() {
    const next = !collapsed;
    setLocalCollapsed(next);
    try {
      window.localStorage.setItem(navigationPreferenceKey, String(next));
      window.dispatchEvent(new Event("relay:navigation-preference"));
      setLocalCollapsed(null);
    } catch {
      /* Keep the toggle usable when browser storage is unavailable. */
    }
  }
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  const [sidebarFooter, setSidebarFooter] = useState<HTMLDivElement | null>(
    null,
  );
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const closeSidebar = useCallback(() => setMobileNavigation(false), []);
  const restoreSidebarFocus = useCallback(() => {
    if (!navigationTrigger.current) return false;
    navigationTrigger.current.focus();
    return true;
  }, []);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [heading, setHeading] = useState<HTMLDivElement | null>(null);
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const slots = useMemo(
    () => ({
      sidebar,
      sidebarFooter,
      toolbar,
      heading,
      closeSidebar,
      restoreSidebarFocus,
    }),
    [sidebar, sidebarFooter, toolbar, heading, closeSidebar, restoreSidebarFocus],
  );

  // The theme also lives on body so portaled menus share the tokens.
  useEffect(() => {
    document.body.classList.add(airframe.airframe, s.theme);
    return () => document.body.classList.remove(airframe.airframe, s.theme);
  }, []);

  const drawer = useRef<HTMLDivElement>(null);
  // Leaving the compact layout closes the drawer, so it doesn't reopen later.
  if (!compact && mobileNavigation) setMobileNavigation(false);
  const navigationOpen = compact && mobileNavigation;
  const closeDrawer = useCallback(() => {
    setMobileNavigation(false);
    restoreSidebarFocus();
  }, [restoreSidebarFocus]);
  // Any navigation (shell, page-owned or account links) closes the drawer.
  useEffect(() => {
    if (!navigationOpen) return;
    const close = () => setMobileNavigation(false);
    window.addEventListener("hashchange", close);
    window.addEventListener("popstate", close);
    return () => {
      window.removeEventListener("hashchange", close);
      window.removeEventListener("popstate", close);
    };
  }, [navigationOpen]);
  // Modal behavior: focus moves in, Tab stays inside, Escape closes.
  useEffect(() => {
    if (!navigationOpen) return;
    const focusable = () =>
      [
        ...(drawer.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An open disclosure inside the drawer (the account menu) takes it first.
        if (
          event.defaultPrevented ||
          drawer.current?.querySelector('[aria-expanded="true"][data-account-trigger]')
        )
          return;
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !drawer.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigationOpen, closeDrawer]);

  const brand = branding();
  const views: ViewLink[] = [
    { href: appPath(), label: "Sessions", icon: SessionsIcon, rail: "Agents" },
    { href: "#/messages", label: "Messages", icon: MessageSquare, rail: "Agents" },
    { href: "#/flows", label: "Flows", icon: FlowsIcon, rail: "Flows" },
  ];

  const context = (
    <>
      <div className={s.sidebarBody}>
        <a
          href={appPath()}
          aria-label={brand.productName}
          title={brand.productName}
          className={s.workspaceBrand}
          onClick={closeSidebar}
        >
          <BrandLockup
            brand={brand}
            markClassName="h-5"
            wordmarkClassName={s.brandWordmark}
          />
        </a>
        <nav aria-label="Workspace views" className={s.navGroup}>
          {views.map(({ href, label: name, icon: Icon, rail: target }) => (
            <a
              key={name}
              aria-label={name}
              title={name}
              href={href}
              className={s.sidebarRow}
              aria-current={viewIsCurrent(name, target, rail, label, views) ? "page" : undefined}
              onClick={closeSidebar}
            >
              <Icon aria-hidden="true" />
              <span>{name}</span>
            </a>
          ))}
        </nav>
        <div
          ref={setSidebar}
          className={s.sidebarSlot}
          data-workspace-slot="sidebar"
        />
      </div>
      {!compact && (
        <div className={s.sidebarCollapse}>
          <Button
            variant="ghost"
            className={s.sidebarRow}
            onClick={toggleNavigation}
            ref={navigationTrigger}
            aria-controls="workspace-navigation"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
            <span>Collapse sidebar</span>
          </Button>
        </div>
      )}
      <div className={s.sidebarSettings}>
        <a
          href="#/settings/workspace"
          aria-label="Settings"
          title="Settings"
          aria-current={rail === "Settings" ? "page" : undefined}
          className={s.sidebarRow}
          onClick={closeSidebar}
        >
          <Settings2 aria-hidden="true" />
          <span>Settings</span>
        </a>
      </div>
      <div className={s.sidebarAccount}>{accountControl}</div>
      {brand.poweredBy && (
        <p
          className={`${s.poweredBy} px-5 pb-3 text-[11px] text-muted-foreground`}
          data-powered-by
        >
          Powered by Agent Relay
        </p>
      )}
      <div
        ref={setSidebarFooter}
        className={s.sidebarFooter}
        data-workspace-slot="sidebarFooter"
      />
    </>
  );

  return (
    <WorkspaceViewSlotsContext.Provider value={slots}>
      <div
        className={cn(airframe.airframe, s.theme, s.shell)}
        data-workspace-shell="cloud"
      >
        <a
          href="#dashboard-content"
          className={s.skipLink}
          onClick={(event) => {
            // Routes live in the hash; focus the content without navigating.
            event.preventDefault();
            document.getElementById("dashboard-content")?.focus();
          }}
        >
          Skip to content
        </a>
        <div className={s.body}>
          {!compact && (
            <aside
              id="workspace-navigation"
              className={cn(s.sidebar, collapsed && s.collapsedSidebar)}
              aria-label="Workspace navigation"
            >
              {context}
            </aside>
          )}
          <div className={s.center}>
            <header className={s.topbar}>
              {compact && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  ref={navigationTrigger}
                  onClick={() => setMobileNavigation(true)}
                  aria-label="Open workspace navigation"
                  aria-expanded={navigationOpen}
                >
                  <PanelLeft />
                </Button>
              )}
              <div className={s.heading}>
                <div
                  ref={setHeading}
                  className={s.headingSlot}
                  data-workspace-slot="heading"
                />
                <div className={s.defaultHeading}>
                  <h1>{label}</h1>
                </div>
              </div>
              <div
                ref={setToolbar}
                className={s.toolbarSlot}
                data-workspace-slot="toolbar"
              />
            </header>
            <main id="dashboard-content" tabIndex={-1} className={s.content}>
              {children}
            </main>
          </div>
        </div>
        {navigationOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={closeDrawer}
          />
        )}
        {navigationOpen && (
          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-full w-3/4 max-w-sm flex-col border-r bg-[var(--sidebar)] shadow-lg",
              s.mobileSheet,
            )}
          >
            <p className="sr-only">
              Views and filters{workspaceName ? ` for ${workspaceName}` : ""}.
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3"
              aria-label="Close"
              onClick={closeDrawer}
            >
              <X />
            </Button>
            <div className={s.mobileContext}>{context}</div>
          </div>
        )}
      </div>
    </WorkspaceViewSlotsContext.Provider>
  );
}
