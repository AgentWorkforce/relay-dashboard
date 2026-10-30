# Relay Dashboard

This is an Apache-2.0, standalone React SPA built with Vite, TanStack Router,
and TanStack Query. Cloud owns authentication, authorization and product operations.

- Keep this repository independently installable from public npm packages.
- Do not import private Cloud source, database clients, server actions or SST resources.
- All Cloud access goes through `src/api/`; validate responses in feature modules.
- Never put credentials in VITE_ variables, source, fixtures, browser storage or logs.
- Keep authentication explicit. Browser and desktop share HTTP contracts, not runtime internals.
- Do not invent API contracts or claim production connections work without an authenticated end-to-end check.
- Make fixture/demo data explicit. Never silently replace a failed live request with fixtures.
- Preserve workspace authorization and provider source when identifying sessions.
- Run `npm run check` before opening a PR. Add behavioral tests for API integrations.
- Static hosts must serve index.html for application routes, without rewriting API traffic.
- Use feature branches and PRs; do not push directly to main.
- If `trail` exists on PATH, record decisions and completion. Never install it implicitly.
