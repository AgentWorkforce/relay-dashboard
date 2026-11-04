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

Self-hosted images serve the SPA at `/` next to a chart-rendered
`/runtime-config.js` (`window.__AGENT_RELAY_DASHBOARD_CONFIG__` with `appPath`,
`apiBasePath`, `loginPath`). Build them with:

```sh
DASHBOARD_BASE_PATH=/ DASHBOARD_RUNTIME_CONFIG_URL=/runtime-config.js npm run build
```

`DASHBOARD_BASE_PATH` sets the asset base (default `/dashboard/`) and must match
the runtime `appPath`. The SPA reads `appPath` and `loginPath`; it always calls
the API at `/cloud/api` on its own origin, so route that prefix to relaycontrol
(`apiBasePath` in the config is informational). `DASHBOARD_RUNTIME_CONFIG_URL` adds the config script to
`index.html`; leave it unset for hosted builds. Routes are `#/flows…`,
`#/settings/<section>`, and query parameters for sessions, so no history
fallback is needed.

### Customer profile (enterprise branding)

Self-hosted images can carry a customer's brand without a rebuild. Set
`DASHBOARD_CUSTOMER_PROFILE` (the chart's `customerProfile` value) to one JSON
object. The image writes it into `/runtime-config.js` as `customerProfile`, and
the SPA validates each field and ignores the ones it can't use:

| field | effect |
| --- | --- |
| `productName` | Replaces "Agent Relay" in the sidebar, the device page and labels (when there is no logo, the name is shown in place of the wordmark). |
| `title` | Document title (defaults to `productName` when set, otherwise `Agent Relay · Dashboard`). |
| `logo` | `{ "light": url, "dark": url }`, or one URL for both themes. Replaces the mark and wordmark. |
| `favicon` | Favicon URL. |
| `accentColor` | Links, focus rings and active navigation (`#hex`, `rgb()`, `hsl()`, `oklch()`). |
| `brandColor` | The solid primary button. |
| `supportUrl` | Adds Support to the account menu and the device page (`https`, `http`, `mailto:` or a same-origin path). |
| `poweredByAgentRelay` | `false` hides the "Powered by Agent Relay" line shown under a custom brand. |

Logo and favicon URLs may be `https`/`http`, same-origin paths or supported
`data:image` types (PNG, SVG, JPEG, WebP, GIF or icons, up to about 60 KB).
Colors must be `#hex`, `rgb()`, `hsl()`, `oklch()` or `oklab()` values the browser accepts; any other value keeps the default, and the
primary button's text turns dark on a light `brandColor`. Without a profile
(and always in the hosted build, which has no runtime config) the dashboard
looks exactly as before.

The container refuses to start when `DASHBOARD_CUSTOMER_PROFILE` is not a
single-line JSON object or is larger than 64 KiB. A value that is shaped like
an object but is not valid JSON starts normally with the default branding.
Example:

```sh
DASHBOARD_CUSTOMER_PROFILE='{"productName":"Acme Relay","logo":{"light":"https://acme.example/logo-dark-text.svg","dark":"https://acme.example/logo-light-text.svg"},"favicon":"https://acme.example/favicon.svg","accentColor":"#7c3aed","brandColor":"#5b21b6","supportUrl":"mailto:support@acme.example","poweredByAgentRelay":true}'
```

`npm run check` runs lint, tests and the production build. Apache-2.0.
