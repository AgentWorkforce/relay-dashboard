# Relay Dashboard

An open-source, client-side dashboard for Agent Relay Cloud. Built with React,
TypeScript, Vite, TanStack Router and TanStack Query. Licensed under Apache-2.0.

## Status

This repository has been reset from the legacy dashboard/server monorepo to a
standalone SPA. It currently includes a responsive application shell, sessions
landing page, connection information, HTTP transport, and CI. **Sign-in, live
sessions, replay and mutations are not implemented yet.** The app makes no Cloud
requests on startup and contains no fabricated session data.

## Development

Requires Node.js 22.12+ and npm. No private repository, registry or backend needed.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the printed localhost URL. The dev server uses port 5173 and fails if occupied.

```sh
npm run check   # lint, transport tests, typecheck and production build
npm run preview
```

`VITE_CLOUD_API_BASE_URL` selects the API base, including `/api/v1`. It defaults to
`https://agentrelay.com/cloud/api/v1`. Every VITE_ variable is public browser code:
never use one for a token or secret. Changing the URL does not establish sign-in.

## API boundary

Cloud remains the backend. The SPA owns navigation and presentation; Cloud owns
permissions, credentials, integrations and execution. The desktop app is another
consumer of the same HTTP contracts. This repository must not import Cloud source.

`src/api/client.ts` provides an explicit cookie or bearer GET transport and returns
unknown JSON for feature-level validation. It is not connected to the UI yet.
Cookie mode sends cookies only to the same origin. Bearer mode uses an injected
access-token provider and never persists tokens. Redirects are rejected. Token
acquisition and refresh must be implemented with Cloud's supported auth contract.

A locally hosted dashboard needs an agreed browser authentication flow and allowed
origins on the API; a production URL alone is insufficient. Do not disable CSRF or
add wildcard credentialed CORS to make development work. Use a dedicated workspace
for hosted write testing; production writes affect real data.

Next steps:

1. Establish browser sign-in, refresh, logout and workspace selection with Cloud.
2. Consume verified session list/search/metadata contracts and expose replay via API.
3. Verify the same session and workspace permissions in browser and desktop.
4. Add mutations as Cloud exposes client-neutral contracts; remove old dashboard
   surfaces as their replacements ship.

Clear query caches on sign-out/account changes and scope query keys by identity,
workspace and API environment. Avoid putting secrets or account data into static
builds. Shared OpenAPI contracts should eventually produce browser and Rust clients.

## Deployment

`npm run build` produces `dist/`. Serve it on a static host with an index.html fallback
for client routes such as `/connection`. Preserve normal API routing if serving the
SPA and API on one origin. No Node server, Next.js runtime, Docker container or npm
package publication is required. Deployment and production cutover are not wired yet.

The previous implementation remains available in Git history. Existing published
packages and deployments have not been removed by this source reset.
