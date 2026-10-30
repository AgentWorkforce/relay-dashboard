import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { apiBaseUrl } from "./config";

function Shell() {
  return <div className="app">
    <a className="skip-link" href="#content">Skip to content</a>
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">r</span> Agent Relay</Link>
      <div className="workspace"><span className="workspace-icon" aria-hidden="true">W</span><div>Workspace<small>Not connected</small></div></div>
      <nav aria-label="Dashboard">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "active", "aria-current": "page" }}>Sessions</Link>
        <Link to="/connection" activeProps={{ className: "active", "aria-current": "page" }}>Connection</Link>
      </nav>
      <a className="source-link" href="https://github.com/AgentWorkforce/relay-dashboard">Open source <span aria-hidden="true">↗</span></a>
    </aside>
    <div className="main-column">
      <header className="topbar"><span>Dashboard</span><span className="status">Not connected</span></header>
      <main id="content"><Outlet /></main>
    </div>
  </div>;
}

function Sessions() {
  return <>
    <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Sessions</h1><p>Your agents’ work, in one place.</p></div></div>
    <section className="empty-state" aria-labelledby="connect-heading">
      <div className="session-symbol" aria-hidden="true">≡</div>
      <h2 id="connect-heading">A new home for your sessions</h2>
      <p>This dashboard is being built as an independent Cloud client. Account sign-in and session browsing are coming next.</p>
      <Link className="button" to="/connection">View connection setup <span aria-hidden="true">→</span></Link>
      <small>No Cloud data has been loaded.</small>
    </section>
  </>;
}

function Connection() {
  return <>
    <div className="page-heading"><div><p className="eyebrow">Settings</p><h1>Connection</h1><p>One Cloud account, across your clients.</p></div></div>
    <section className="panel" aria-labelledby="cloud-heading">
      <div className="panel-heading"><h2 id="cloud-heading">Cloud API</h2><span className="status">Not connected</span></div>
      <p>The dashboard will use this endpoint when sign-in is available.</p>
      <dl><dt>API endpoint</dt><dd><code>{apiBaseUrl}</code></dd></dl>
      <div className="notice"><strong>Sign-in is not available yet</strong><p>This initial release establishes the dashboard shell. It does not connect to your account or send requests to Cloud.</p></div>
    </section>
  </>;
}

const root = createRootRoute({
  component: Shell,
  notFoundComponent: () => <section className="empty-state"><h1>Page not found</h1><Link className="button" to="/">Back to sessions</Link></section>,
});
const sessions = createRoute({ getParentRoute: () => root, path: "/", component: Sessions });
const connection = createRoute({ getParentRoute: () => root, path: "/connection", component: Connection });
export const router = createRouter({ routeTree: root.addChildren([sessions, connection]) });
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
