# Agent Relay Dashboard

A React/Vite page that lists sessions from Cloud. It uses agentrelay.com’s
existing login and HttpOnly session cookie. Clicking a session opens its Cloud
conversation. No separate authentication, preview mode, or production-data proxy.

## Run

Install dependencies here with `npm ci`, then run `npm run dev` from the Cloud
checkout. Open the printed gateway URL, normally http://localhost:3100/dashboard/.
Cloud starts Vite and marketing proxies `/dashboard` to it. `/login` and
`/cloud/api` remain on the shared origin. Opening Vite directly does not provide
a login or backend.

The same arrangement applies in production at agentrelay.com/dashboard/.
`npm run build` produces static assets; `wrangler.jsonc` is the static host config.

`npm run check` runs lint, tests and the production build. Apache-2.0.
