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
