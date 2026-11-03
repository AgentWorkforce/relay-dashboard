# Agent Relay Dashboard

A React/Vite page for Agent Relay sessions: the session list with filters,
full transcripts (prompts, replies, tool calls and results, diffs, subagents),
message search, and team activity. It uses the existing login and HttpOnly
session cookie and reads only the `/cloud/api` session routes, which scope every
read to the signed-in workspace. Session links are `?session=<id>&source=<source>`
on the app's base path; hosted `/dashboard/sessions/<id>?source=` links also open.
No separate authentication, preview mode, or production-data proxy.

## Run

Install dependencies here with `npm ci`, then run `npm run dev` from the Cloud
checkout. Open the printed gateway URL, normally http://localhost:3100/dashboard/.
Cloud starts Vite and marketing proxies `/dashboard` to it. `/login` and
`/cloud/api` remain on the shared origin. Opening Vite directly does not provide
a login or backend.

The same arrangement applies in production at agentrelay.com/dashboard/.
`npm run build` produces static assets; `wrangler.jsonc` is the static host config.

`npm run check` runs lint, tests and the production build. Apache-2.0.
