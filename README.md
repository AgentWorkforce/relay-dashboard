# Agent Relay Dashboard

An Apache-2.0, client-side dashboard for Agent Relay Cloud. React + Vite,
TanStack Router/Query, and shadcn/Radix components, styled from the Agent Relay
brand guide. No private packages, local Cloud checkout, database, or server
application is needed to build it.

## Run locally against Cloud

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/**. Choose **Continue with Agent Relay**, then
**Approve sign-in**. The hosted Cloud page handles Google sign-in and asks you to
approve the matching code. Return to the dashboard; it continues automatically.
Only approve a code you started yourself.

The dev server proxies a narrow set of public Cloud endpoints to
https://agentrelay.com. It strips cookies and Set-Cookie; the SPA uses explicit
bearer credentials. It does not need a local Cloud service or new backend deploy.
It refuses to reuse an occupied port.

To use the local Cloud stack, start that stack with Cloud's own `npm run dev`, then
set `CLOUD_API_ORIGIN=http://localhost:3100` in `.env.local`. The proxy target and
browser approval/link origin must refer to the same Cloud environment; the Vite
config derives the browser origin from this value unless explicitly overridden.

## Included

- Device authorization, consent polling/backoff/cancellation, shared token refresh,
  workspace selection and sign-out/revocation.
- Session list, server search, pagination, project/harness/active filters, optional
  model column, automatic refresh and session details.
- Full-conversation links preserve workspace and source and open the current Cloud
  replay view. That view may ask for its own normal browser sign-in.
- Account, network, permission, empty, loading and customer-hosted History states.
- Desktop and phone layouts, keyboard search (`/`), accessible Radix menus and sheets.

The API still names the workspace picker `/auth/desktop/workspaces`. It supports
ordinary renewable operator tokens as well as desktop tokens; this SPA does not
request desktop-specific consent or impersonate a desktop installation.

## Current boundaries

Credentials are held **only in tab memory**. Reloading/closing the tab requires
another sign-in. Refresh-token rotation works while the tab remains open. Persistent
browser sign-in should be designed separately rather than putting operator refresh
tokens into localStorage. Device authorization uses the backend's existing operator
scopes; this UI exposes session reads and account operations, not all token powers.

The sessions shown are uploaded Cloud sessions. Local-only desktop sessions are
not remotely accessible. Project, harness and Active filters apply to **loaded**
rows; search is server-side. Active means a recorded active state newer than five
minutes, not proof of a currently reachable agent. Unknown activity is “Recorded.”
Full transcript rendering, mutations, and persistent sign-in are not implemented.

## Design preview and verification

`http://127.0.0.1:5173/?preview=1` is an explicitly labeled, development-only preview.
It never calls Cloud and is not a fallback for live errors. Its fixture module is
excluded from production builds.

```sh
npm run check     # ESLint, behavioral tests, typecheck, production build
npm run test:ui   # component flow tests
```

Tests cover consent polling, concurrency in refresh, logout races, cancellation,
source/workspace identity, outage handling, search and the details panel.
They do not replace a real account approval and session-list check.

## Deploy as a static SPA

```sh
npm run build
```

Serve `dist/` with an index.html fallback for client routes. No Next.js or Node
runtime is required. All `VITE_` configuration is public browser code. Never put
credentials in these variables. Fonts and brand assets are served locally.

The default hosted client origin is `https://dashboard.agentrelay.com`. Direct
browser calls require the companion Cloud CORS change to be deployed. It allows
that exact origin and the two localhost:5173 development origins only, rejects
ambient cookies, and limits methods/endpoints. Other OSS deployments need their
origin explicitly registered by their API operator or a same-origin gateway with
equivalent restrictions. Hosting/DNS and production deployment are not part of
this implementation.

## Source layout

- `src/api/`: validated Cloud contracts, transport and auth lifecycle.
- `src/auth/`: sign-in UI.
- `src/dashboard.tsx`: workspace and sessions experience.
- `src/components/ui/`: shadcn components, with brand shape/accessibility adjustments.
- `src/brand.css`: published Agent Relay brand tokens.

Cloud retains permissions and data ownership. This repository is another API
client, alongside desktop. See LICENSE for Apache-2.0 terms; brand assets do not
grant trademark rights.
