---
paths:
  - "packages/dashboard-server/src/routes/**/*.ts"
---

# Auth Middleware Coverage

All mutation endpoints (POST, PUT, PATCH, DELETE) that modify credentials, tokens, or sensitive configuration must be covered by workspace-token validation middleware.

When adding new route files or endpoints:
- Check if the endpoint modifies sensitive state (credentials, API keys, auth tokens)
- Apply `validateWorkspaceToken` middleware via `app.use()` on the route prefix
- Never assume network isolation is sufficient protection

Example:
```typescript
app.use('/api/credentials', validateWorkspaceToken);
```
