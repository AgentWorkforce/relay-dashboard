---
paths:
  - "packages/dashboard-server/src/**/*.ts"
---

# Shell Execution Security

Never use `exec()` with string interpolation for shell commands. Always use `execFile()` with array arguments to prevent command injection.

```typescript
// WRONG - command injection vulnerability
exec(`bd create --title="${title}"`, callback);

// CORRECT - array args, no shell
execFile('bd', ['create', '--title', title.trim()], callback);
```

When accepting user input for CLI arguments:
- Validate type and format before passing to execFile
- Use `.trim()` on string inputs
- Return 400 for invalid inputs before reaching execution
