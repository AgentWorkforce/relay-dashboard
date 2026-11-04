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
The look is hosted Cloud's: src/globals.css is cloud/packages/web/app/globals.css
(Tailwind v4 tokens) and src/shell/ holds the ported workspace chrome, CSS
modules and shadcn primitives. Copy from Cloud rather than restyling; page
stylesheets sit in the `legacy` cascade layer (below Tailwind utilities).
brand.css supplies the brand scales and status/harness tokens.
Run npm run check. Do not merge or deploy without authorization.
