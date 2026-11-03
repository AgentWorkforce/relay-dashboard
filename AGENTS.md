# Dashboard

This is the self-hosted Agent Relay dashboard. It aims for parity with the
hosted Cloud dashboard for the features a self-hosted install runs:

- sessions (list, filters, transcript, search, activity);
- flows (definitions, runs, steps, logs, workers);
- admin settings (workspace env vars, provider connections, API tokens,
  members);
- device approval.

Port behaviour and UX from Cloud; don't invent new flows.

Use the existing `/cloud/api` contracts served by relaycontrol. Use Cloud's
shared cookie login and device authorization only. Don't add another auth
mechanism, developer credential storage, sample-data mode, or general-purpose
proxy. Keep hosted-only features (billing, hosted MCP, identity sync) out
unless relaycontrol implements them.

Never display a secret value after creation; show masked values only.
Use brand.css, semantic colors, and the supplied logo assets.
Run npm run check. Do not merge or deploy without authorization.
