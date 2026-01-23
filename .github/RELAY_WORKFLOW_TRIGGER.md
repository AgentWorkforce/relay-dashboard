# Relay Workflow Trigger

Add this workflow to the **relay** repository at `.github/workflows/trigger-dashboard-sync.yml`:

```yaml
name: Trigger Dashboard Sync

on:
  push:
    branches: [main]
    paths:
      - 'src/dashboard/**'
      - 'packages/dashboard/**'
  release:
    types: [published]

jobs:
  trigger-sync:
    runs-on: ubuntu-latest

    steps:
      - name: Trigger dashboard sync
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.DASHBOARD_SYNC_TOKEN }}
          repository: AgentWorkforce/relay-dashboard
          event-type: sync-dashboard
          client-payload: '{"version": "${{ github.ref_name }}", "sha": "${{ github.sha }}"}'

      - name: Trigger deployment
        if: github.event_name == 'release'
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.DASHBOARD_SYNC_TOKEN }}
          repository: AgentWorkforce/relay-dashboard
          event-type: deploy-dashboard
          client-payload: '{"version": "${{ github.ref_name }}"}'
```

## Required Secrets

### In relay repository:
- `DASHBOARD_SYNC_TOKEN`: Personal access token with `repo` scope for `AgentWorkforce/relay-dashboard`

### In relay-dashboard repository:
- `RELAY_SYNC_TOKEN`: Personal access token with `repo` scope for `AgentWorkforce/relay`
- `NPM_TOKEN`: npm authentication token for publishing
- `FLY_API_TOKEN`: Fly.io deploy token
