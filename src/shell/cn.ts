/** Hosted Cloud's `cn` (lib/utils.ts): joins truthy class names. */
export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
