# Relay Dashboard

This is an Apache-2.0 SPA: React, Vite, TanStack Router/Query, and shadcn/Radix.
Cloud owns authentication, authorization, integrations and session storage.

- Keep this repository independently buildable from public npm dependencies.
- No imports from private Cloud repositories, database clients, or server actions.
- Keep API calls and response validation in src/api. Do not invent backend contracts.
- Use the existing HttpOnly Cloud session cookie through same-origin /cloud/api requests. Never mint browser bearer tokens or store credentials in JavaScript. The real /login page belongs to agentrelay.com. The explicit production-read development bridge may hold an operator credential server-side in ignored .local only; never expand its read allowlist to writes or expose that file through Vite.
- Keep sample data explicitly labeled and development-only. Never substitute it for failed live requests.
- Session identity includes workspace, source and sessionId; preserve all three in links/cache keys.
- Scope query data to the account/workspace; cancel and clear it on auth changes.
- Follow src/brand.css (copied with permission from agentrelay.com), Inter/Sora fonts,
  semantic colors, and the asymmetric message-tail corners. Compose the checked-in UI components.
- Run npm run check before opening a PR. Add regression tests for auth and data-boundary changes.
- Work on feature branches. Do not merge or deploy without explicit authorization.
- Run trail only if already on PATH. Do not install it implicitly.
