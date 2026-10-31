# Agent Relay Dashboard

Open-source React/Vite SPA at **https://agentrelay.com/dashboard/**. Cloud owns
sessions, authorization, and persistence; agentrelay.com owns the actual login
page. The dashboard uses the same dark brand palette, Inter/Sora fonts, and
shadcn/Radix components.

## Authentication

The SPA checks `/cloud/api/auth/session?renew=0` on load. Existing HttpOnly Cloud
cookies authenticate same-origin requests automatically, including after reload.
A definite signed-out response navigates to `/login?next=%2Fdashboard%2F` — the
real marketing login page, not a copy. Google/Microsoft OAuth sets the existing
Cloud session cookie and returns to `/dashboard/`.

No device flow, bearer token minting, credential storage, CORS, or custom login
page. Workspace changes POST `/cloud/api/auth/workspace`; sign-out POSTs
`/cloud/api/auth/logout`. Cookie-changing requests are serialized. Failed logout
keeps the session visible and reports the error. A failed session check displays
retry rather than treating an outage as sign-out. Session reads use `renew=0`
to prevent a late read from restoring an old cookie after logout/switching.

## Development

```sh
npm ci
npm run dev
```

For design-only review, open http://127.0.0.1:5173/dashboard/?preview=1. Sample
data is explicitly labeled and excluded from production builds.

For actual login, use Cloud's shared-origin development launcher (`npm run dev`
from Cloud; see its Local Setup). Configure the marketing process with
`DASHBOARD_DEV_ORIGIN=http://127.0.0.1:5173` and use the gateway's printed hostname
at `/dashboard/`. Marketing proxies that path to Vite and `/cloud` to Cloud;
`/login` remains its own page. Do not log in on Vite's port or proxy production
cookies onto localhost. The OAuth callback must be registered for the gateway
origin. The companion Cloud change handles the explicit `/dashboard/` return;
legacy `/cloud/dashboard/*` links remain available.

## Develop against production data

```sh
npm run login:prod  # one-time browser approval; checks the displayed code
npm run dev:prod
```

Open http://127.0.0.1:5173/dashboard/ and edit normally with hot reload. If the
Cloud launcher already owns 5173, use `npm run dev:prod -- --port 5174` and open
that port instead. This mode is self-contained; it does not need local Cloud,
History or the marketing gateway. For the shared launcher use
`DEV_DASHBOARD_API=production-read npm run dev` from Cloud after signing in here.

The UI says **Production · read only**. It uses the production account's current
workspace, real session pages, search, and pagination. Workspace switching and
sign-out controls are disabled in this mode; change the account's workspace in
Cloud before refreshing the UI. No local API fallback or sample data is used.

The Vite-only bridge exposes account/session GETs and rejects every other route
or method. Credential refresh is its only internal authenticated POST. The
underlying operator credential is not a read-only token; the bridge enforces
the read-only boundary for the UI. It is saved with mode 0600 under ignored
`.local/production-auth.json`, outside browser storage. Vite denies access to
`.local` files. No credentials, cookies, arbitrary headers, or arbitrary URLs
are forwarded from the browser. No CORS is enabled. The bridge is excluded from
production builds and never changes the hosted cookie login.

Run `npm run login:prod` again if authorization expires. Treat this local
checkout and its code as trusted: it holds a developer credential. To disconnect,
revoke the developer session in Cloud and remove `.local/production-auth.json`.
Normal `npm run dev` uses local cookies again.

## Hosting

`npm run build` creates `dist`. `wrangler.jsonc` describes a static-only Worker
named `relay-dashboard`, with SPA fallback and no public domain. It has no
backend credentials or API proxy. A human/CI publishes it, then enables the
`DASHBOARD_ASSETS` service binding in agentrelay.com's router. That router strips
`/dashboard` for static asset lookup. Vite and TanStack Router keep `/dashboard/`
as the browser base. `/login` and `/cloud/api` stay on their existing services.
Deploy Cloud's OAuth return support before enabling the router binding.
No deploy occurs through this project's checks.

## Checks

`npm run check` runs lint, tests, TypeScript and production build. Tests cover
cookie-session restoration, unavailable vs signed-out states, serialized cookie
changes, logout failure, auth expiry, query cleanup and session browsing.

The shell includes server search, cursor pagination, workspace selection,
project/harness/status filters over loaded rows, and session details. Full
conversations still open in Cloud. Apache-2.0; see LICENSE.
