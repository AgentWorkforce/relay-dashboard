import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Cloud,
  Folder,
  Code2,
  List,
  LogOut,
  Search,
  RefreshCw,
  SlidersHorizontal,
  X,
  AlertCircle,
  LoaderCircle,
  PanelLeft,
  Terminal,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Login } from "@/auth/login";
import type { CloudClient } from "@/api/client";
import type { Account, Session } from "@/api/contracts";
import {
  harnessName,
  relativeTime,
  replayUrl,
  sessionKey,
  sessionStatus,
  uniqueSessions,
} from "@/sessions";
import { cn } from "@/lib/utils";

export type PreviewData = { account: Account; sessions: Session[] };
export function Dashboard({
  client,
  preview,
}: {
  client: CloudClient;
  preview?: PreviewData;
}) {
  const revision = useSyncExternalStore(client.subscribe, client.snapshot);
  const cache = useQueryClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  useEffect(
    () =>
      client.subscribe(() => {
        void cache.cancelQueries();
        cache.clear();
      }),
    [client, cache],
  );
  async function logout() {
    try {
      await client.logout();
    } catch {
      setSignOutError(
        "Could not sign out. Your session is still active. Please try again.",
      );
    }
  }
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (preview || client.initialized) return;
    const controller = new AbortController();
    void client.restore(controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        setRestoreError(
          error instanceof Error
            ? error.message
            : "Could not check your session.",
        );
    });
    return () => controller.abort();
  }, [client, preview, attempt]);
  if (!preview && !client.initialized)
    return (
      <main className="auth-status">
        {restoreError ? (
          <>
            <p role="alert">{restoreError}</p>
            <Button
              onClick={() => {
                setRestoreError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <p>Checking your session…</p>
        )}
      </main>
    );
  if (!client.signedIn && !preview) return <Login />;
  return (
    <>
      {signOutError && (
        <Alert variant="destructive">
          <AlertDescription>{signOutError}</AlertDescription>
        </Alert>
      )}
      <Workspace
        key={revision}
        client={client}
        preview={preview}
        onLogout={() => void logout()}
      />
    </>
  );
}

function Workspace({
  client,
  preview,
  onLogout,
}: {
  client: CloudClient;
  preview?: PreviewData;
  onLogout: () => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [harness, setHarness] = useState("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const account = useQuery({
    queryKey: ["account"],
    queryFn: ({ signal }) =>
      preview ? Promise.resolve(preview.account) : client.account(signal),
    initialData: preview?.account,
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: ({ signal }) =>
      preview
        ? Promise.resolve({
            workspaces: preview.account.currentWorkspace
              ? [
                  {
                    ...preview.account.currentWorkspace,
                    organization_name:
                      preview.account.currentOrganization?.name,
                  },
                ]
              : [],
          })
        : client.workspaces(signal),
  });
  const switchWorkspace = useMutation({
    mutationFn: (id: string) => client.selectWorkspace(id),
  });
  const workspace = account.data?.currentWorkspace;
  const sessions = useInfiniteQuery({
    queryKey: ["sessions", account.data?.user.id, workspace?.id, query],
    enabled: Boolean(workspace),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      preview
        ? Promise.resolve({
            items: preview.sessions.filter((item) =>
              `${item.summary} ${item.project?.name} ${item.source}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
            nextCursor: null,
            error: false,
            members: [],
          })
        : client.sessions(workspace!.id, query, pageParam, signal),
    getNextPageParam: (last, pages) =>
      last.nextCursor &&
      !pages.slice(0, -1).some((page) => page.nextCursor === last.nextCursor)
        ? last.nextCursor
        : undefined,
    refetchInterval: 60_000,
  });
  const allRows = uniqueSessions(sessions.data?.pages ?? []);
  const projects = [
    ...new Map(
      allRows
        .filter((row) => row.project)
        .map((row) => [row.project!.key, row.project!]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const harnesses = [...new Set(allRows.map((row) => row.source))].sort();
  const rows = allRows.filter(
    (row) =>
      (!project || row.project?.key === project) &&
      (harness === "all" || row.source === harness) &&
      (!activeOnly || sessionStatus(row, now) === "Active"),
  );
  const active = allRows.filter(
    (row) => sessionStatus(row, now) === "Active",
  ).length;
  const user = account.data?.user;
  const displayName = user?.name || user?.email || "Your account";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  function resetFilters() {
    setSearch("");
    setQuery("");
    setProject(null);
    setHarness("all");
    setActiveOnly(false);
  }
  const filtered = Boolean(query || project || harness !== "all" || activeOnly);
  const nav = (
    <>
      <a className="brand" href="/dashboard/">
        <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" />
        <span>Agent Relay</span>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="workspace-picker"
            disabled={switchWorkspace.isPending || !workspaces.data}
          >
            <span className="workspace-monogram">
              {workspace?.name[0]?.toUpperCase() || "W"}
            </span>
            <span className="workspace-copy">
              <strong>{workspace?.name || "Your workspace"}</strong>
              <span>{account.data?.currentOrganization?.name || "Cloud"}</span>
            </span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
          <DropdownMenuGroup>
            {workspaces.data?.workspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={Boolean(preview)}
                onSelect={() => switchWorkspace.mutate(item.id)}
              >
                {item.name}
                {item.id === workspace?.id && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {workspaces.isError && (
        <p className="sidebar-note">
          Workspace list unavailable.{" "}
          <button onClick={() => void workspaces.refetch()}>Retry</button>
        </p>
      )}
      <nav aria-label="Sessions">
        <p className="nav-label">Workspace</p>
        <button
          className={cn("nav-item", !activeOnly && !project && "is-active")}
          onClick={() => {
            setActiveOnly(false);
            setProject(null);
            setMobileNav(false);
          }}
        >
          <List /> All sessions <span>{allRows.length || ""}</span>
        </button>
        <button
          className={cn("nav-item", activeOnly && "is-active")}
          onClick={() => {
            setActiveOnly(true);
            setProject(null);
            setMobileNav(false);
          }}
        >
          <Activity /> Active <span>{active || ""}</span>
        </button>
      </nav>
      {projects.length > 0 && (
        <nav aria-label="Projects in loaded sessions">
          <p className="nav-label">Projects in view</p>
          {projects.map((item) => (
            <button
              key={item.key}
              title={item.detail}
              className={cn("nav-item", project === item.key && "is-active")}
              onClick={() => {
                setProject(item.key);
                setActiveOnly(false);
                setMobileNav(false);
              }}
            >
              <Folder />
              <span className="project-name">{item.name}</span>
              <span>
                {allRows.filter((row) => row.project?.key === item.key).length}
              </span>
            </button>
          ))}
        </nav>
      )}
      <div className="sidebar-bottom">
        <a
          href="https://github.com/AgentWorkforce/relay-dashboard"
          className="nav-item"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Code2 /> Open source <ArrowUpRight />
        </a>
        <Separator />
        <div className="account">
          <span className="avatar">{initials}</span>
          <span className="account-copy">
            <strong>{displayName}</strong>
            <span>{preview ? "Preview workspace" : "Connected to Cloud"}</span>
          </span>
          {preview ? (
            <Button variant="ghost" size="icon" asChild>
              <a href="/dashboard/" aria-label="Exit preview">
                <LogOut />
              </a>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={onLogout}
            >
              <LogOut />
            </Button>
          )}
        </div>
      </div>
    </>
  );
  return (
    <div className="dashboard">
      <a className="skip-link" href="#main">
        Skip to sessions
      </a>
      <aside className="sidebar">{nav}</aside>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Sessions and projects</SheetDescription>
          </SheetHeader>
          <div className="mobile-navigation">{nav}</div>
        </SheetContent>
      </Sheet>
      <div className="dashboard-main">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <PanelLeft />
            </Button>
            <Cloud />
            <span>Cloud</span>
            <span className="breadcrumb-slash">/</span>
            <span>Sessions</span>
          </div>
          <div className="topbar-state">
            {preview ? (
              <Badge variant="secondary">Preview · sample data</Badge>
            ) : (
              <>
                <span className="connection-dot" /> Connected
              </>
            )}
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Your workspace at a glance</p>
              <h1>
                {project
                  ? projects.find((item) => item.key === project)?.name ||
                    "Project sessions"
                  : activeOnly
                    ? "Active sessions"
                    : "Sessions"}
              </h1>
              <p>
                Pick up the thread. See what your agents have been working on.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={sessions.isFetching || !workspace}
              onClick={() => void sessions.refetch()}
            >
              <RefreshCw
                className={sessions.isFetching ? "spin" : undefined}
                data-icon="inline-start"
              />
              Refresh
            </Button>
          </div>
          {switchWorkspace.isError && (
            <ErrorNotice
              error={switchWorkspace.error}
              title="Couldn’t switch workspace"
            />
          )}
          {account.isError && (
            <ErrorNotice
              error={account.error}
              title="Couldn’t load your account"
              retry={() => void account.refetch()}
            />
          )}
          {account.isPending && (
            <div className="loading-account">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {account.data && !workspace && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Folder />
                </EmptyMedia>
                <EmptyTitle>Choose a workspace to get started</EmptyTitle>
                <EmptyDescription>
                  Join or create a workspace in Agent Relay, then sign in here
                  again.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <a
                    href={`${client.cloudOrigin}/cloud/dashboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Agent Relay <ArrowUpRight data-icon="inline-end" />
                  </a>
                </Button>
              </EmptyContent>
            </Empty>
          )}
          {workspace && (
            <section className="session-panel" aria-label="Session browser">
              <div className="list-toolbar">
                <div className="search-box">
                  <Search aria-hidden="true" />
                  <Input
                    ref={searchRef}
                    aria-label="Search sessions"
                    placeholder="Search sessions…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    maxLength={500}
                  />
                  <kbd>/</kbd>
                </div>
                <div className="toolbar-actions">
                  <Select value={harness} onValueChange={setHarness}>
                    <SelectTrigger aria-label="Filter by harness">
                      <SelectValue placeholder="All harnesses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All harnesses</SelectItem>
                        {harnesses.map((source) => (
                          <SelectItem key={source} value={source}>
                            {harnessName(source)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="display-options"
                        aria-label="Display options"
                      >
                        <SlidersHorizontal data-icon="inline-start" />
                        <span className="display-label">Display</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Columns</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        <DropdownMenuCheckboxItem
                          checked={showModel}
                          onCheckedChange={setShowModel}
                        >
                          Show model
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={resetFilters}>
                          Reset filters
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {filtered && (
                <div className="filter-summary">
                  <span>
                    {rows.length} matching loaded sessions
                    {query ? ` for “${query}”` : ""}
                  </span>
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    Clear filters <X data-icon="inline-end" />
                  </Button>
                </div>
              )}
              {sessions.isError && (
                <ErrorNotice
                  error={sessions.error}
                  title="Couldn’t load sessions"
                  retry={() => void sessions.refetch()}
                />
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="session-column">Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Harness</TableHead>
                    {showModel && <TableHead>Model</TableHead>}
                    <TableHead className="updated-column">
                      <span className="inline-flex items-center gap-1">
                        Updated <ArrowDown className="size-3" />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.isPending &&
                    Array.from({ length: 7 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="mt-2 h-3 w-1/3" />
                        </TableCell>
                        {Array.from({ length: showModel ? 5 : 4 }, (_, col) => (
                          <TableCell key={col}>
                            <Skeleton className="h-4 w-20" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {rows.map((row) => (
                    <TableRow
                      key={sessionKey(row)}
                      data-state={
                        selected && sessionKey(selected) === sessionKey(row)
                          ? "selected"
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="session-title-cell">
                          <span
                            className={cn(
                              "harness-mark",
                              `harness-${row.source.replace(/[^a-z-]/g, "")}`,
                            )}
                            aria-hidden="true"
                          >
                            {row.source === "claude" ? (
                              "✳"
                            ) : row.source === "codex" ? (
                              "⌘"
                            ) : (
                              <Terminal />
                            )}
                          </span>
                          <div className="min-w-0">
                            <button
                              className="session-title"
                              onClick={() => setSelected(row)}
                            >
                              {row.summary || "Untitled session"}
                            </button>
                            <div className="session-subtitle">
                              <span>
                                {row.machineIds[0] ||
                                  row.sessionId.slice(0, 12)}
                              </span>
                              <span>·</span>
                              <span>
                                {row.eventCount?.toLocaleString() ?? "—"} events
                              </span>
                            </div>
                            <span className="mobile-session-meta">
                              {harnessName(row.source)} ·{" "}
                              {relativeTime(row.lastTs, now)}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "session-status",
                            sessionStatus(row, now) === "Active" &&
                              "status-active",
                          )}
                        >
                          <span aria-hidden="true" />
                          {sessionStatus(row, now)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className="project-cell"
                          title={
                            row.project?.detail || row.projectId || undefined
                          }
                        >
                          <Folder />
                          {row.project?.name || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="harness-label">
                          {harnessName(row.source)}
                        </span>
                      </TableCell>
                      {showModel && <TableCell>{row.model || "—"}</TableCell>}
                      <TableCell className="updated-column">
                        <time
                          dateTime={row.lastTs || undefined}
                          title={
                            row.lastTs
                              ? new Date(row.lastTs).toLocaleString()
                              : undefined
                          }
                        >
                          {relativeTime(row.lastTs, now)}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!sessions.isPending &&
                !sessions.isError &&
                rows.length === 0 && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        {filtered ? <Search /> : <MessageSquare />}
                      </EmptyMedia>
                      <EmptyTitle>
                        {filtered
                          ? "No sessions match this view"
                          : "Your next session starts the story"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {filtered
                          ? "Try another search or clear your filters. Project and harness filters apply to loaded sessions."
                          : "Sessions uploaded to this workspace will appear here. Connect Agent Relay Desktop to bring your work together."}
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      {filtered ? (
                        <Button variant="outline" onClick={resetFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button variant="outline" asChild>
                          <a href="https://agentrelay.com/download">
                            Get Agent Relay Desktop{" "}
                            <ArrowUpRight data-icon="inline-end" />
                          </a>
                        </Button>
                      )}
                    </EmptyContent>
                  </Empty>
                )}
              <footer className="list-footer">
                <span role="status">
                  {sessions.isPending
                    ? "Loading sessions…"
                    : `${rows.length} of ${allRows.length} loaded sessions`}
                </span>
                {sessions.hasNextPage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sessions.isFetchingNextPage}
                    onClick={() => void sessions.fetchNextPage()}
                  >
                    {sessions.isFetchingNextPage && (
                      <LoaderCircle className="spin" data-icon="inline-start" />
                    )}
                    Load more
                  </Button>
                ) : (
                  <span className="sync-note">
                    <Cloud />
                    {preview
                      ? "Sample data for design review"
                      : "Refreshes every minute"}
                  </span>
                )}
              </footer>
            </section>
          )}
          <p className="page-footnote">
            {preview
              ? "You’re viewing sample sessions. Exit preview to sign in to your real workspace."
              : "Your cloud sessions, across your tools. Local-only sessions stay on your device."}
          </p>
        </main>
      </div>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="session-detail">
          <SheetHeader>
            <p className="eyebrow">Session details</p>
            <SheetTitle>{selected?.summary || "Untitled session"}</SheetTitle>
            <SheetDescription>
              {selected ? harnessName(selected.source) : ""}
              {selected?.project ? ` · ${selected.project.name}` : ""}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="detail-body">
              <Badge variant="outline">{sessionStatus(selected, now)}</Badge>
              <dl>
                {[
                  ["Project", selected.project?.detail || selected.projectId],
                  ["Model", selected.model],
                  [
                    "Updated",
                    selected.lastTs
                      ? new Date(selected.lastTs).toLocaleString()
                      : null,
                  ],
                  ["Events", selected.eventCount?.toLocaleString()],
                  ["Session ID", selected.sessionId],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <Separator />
              <p>
                The full conversation opens in Cloud. Your source and workspace
                travel with the link.
              </p>
              {preview ? (
                <p className="preview-detail-note">
                  Sample session — no live conversation.
                </p>
              ) : (
                <Button asChild>
                  <a
                    href={replayUrl(
                      client.cloudOrigin,
                      workspace!.id,
                      selected,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open conversation <ArrowUpRight data-icon="inline-end" />
                  </a>
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ErrorNotice({
  error,
  title,
  retry,
}: {
  error: Error;
  title: string;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
