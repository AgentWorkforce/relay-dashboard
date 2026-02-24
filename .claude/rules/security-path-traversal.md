---
paths:
  - "packages/dashboard-server/src/**/*.ts"
---

# Path Traversal Prevention

When constructing file paths from user input:
- Validate IDs/names with strict regex (e.g., `/^[a-zA-Z0-9_-]+$/`)
- Use `path.resolve()` and verify the result starts with the expected parent directory + `path.sep`
- Return 400 for invalid format before any filesystem operation

```typescript
// Validate userId format
if (userId && !/^[a-zA-Z0-9_-]+$/.test(userId)) {
  return res.status(400).json({ error: 'Invalid userId format' });
}

// Verify resolved path stays within boundary
const resolvedTarget = path.resolve(targetDir);
if (!resolvedTarget.startsWith(resolvedWorkspace + path.sep)) {
  return res.status(400).json({ error: 'Invalid path' });
}
```
