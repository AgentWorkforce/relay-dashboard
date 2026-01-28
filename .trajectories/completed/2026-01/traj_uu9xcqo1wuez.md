# Trajectory: Add full markdown formatting support to message rendering

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** January 28, 2026 at 02:43 PM
> **Completed:** January 28, 2026 at 02:43 PM

---

## Summary

Added full markdown support to messageFormatting.tsx: headings (#-######), bold (**text**), italic (*text*), strikethrough (~~text~~), lists (- and 1.), markdown links, and improved existing code blocks/blockquotes. Created 34 comprehensive tests. Fixed heading size visibility by using inline styles to override parent text-sm class.

**Approach:** Standard approach

---

## Key Decisions

### Used inline styles for heading font-sizes instead of Tailwind classes
- **Chose:** Used inline styles for heading font-sizes instead of Tailwind classes
- **Reasoning:** Parent container has text-sm class that overrides Tailwind size classes. Inline styles guarantee font-size takes precedence.

### Sequential pattern matching for inline markdown instead of single complex regex
- **Chose:** Sequential pattern matching for inline markdown instead of single complex regex
- **Reasoning:** Avoids lookbehind/lookahead which has spotty browser support. Processes patterns in order of precedence (bold before italic) for reliable matching.

### Mock react-syntax-highlighter in tests
- **Chose:** Mock react-syntax-highlighter in tests
- **Reasoning:** ESM/CommonJS compatibility issues with the library in vitest. Mocking avoids the import errors while still testing formatting logic.

---

## Chapters

### 1. Work
*Agent: default*

- Used inline styles for heading font-sizes instead of Tailwind classes: Used inline styles for heading font-sizes instead of Tailwind classes
- Sequential pattern matching for inline markdown instead of single complex regex: Sequential pattern matching for inline markdown instead of single complex regex
- Mock react-syntax-highlighter in tests: Mock react-syntax-highlighter in tests
