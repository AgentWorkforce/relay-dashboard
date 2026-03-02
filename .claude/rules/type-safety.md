---
paths:
  - "packages/dashboard-server/src/**/*.ts"
---

# Type Safety

Minimize `as any`, non-null assertions (`!`), and broad type casts (`as Record<string, string>`).

- Prefer typed interfaces over `as any` for request query/body fields
- Use optional chaining and nullish coalescing instead of non-null assertions
- When a cast is unavoidable (e.g., Express req.query), keep it at the boundary and validate immediately
- For fire-and-forget promises, always add `.catch()` to prevent unhandled rejections

```typescript
// WRONG
const val = (req.query as any).foo;

// CORRECT
const val = typeof req.query.foo === 'string' ? req.query.foo : undefined;
```
