/**
 * Frontend identity resolution module.
 * Single source of truth for Dashboard identity normalization on the client.
 */

// Dashboard variant pattern (Dashboard, Dashboard-<hex>, dashboard-reader)
const DASHBOARD_VARIANT_PATTERN = /^dashboard(-[0-9a-f]{6,}|-reader)?$/i;

export function isDashboardVariant(name: string): boolean {
  if (!name?.trim()) return false;
  const lower = name.trim().toLowerCase();
  return lower === 'dashboard' || lower === 'human:dashboard' || DASHBOARD_VARIANT_PATTERN.test(name.trim());
}

/**
 * Get the project display identity from available sources.
 * Priority: explicit param > localStorage > "Dashboard"
 */
export function getProjectIdentity(explicitIdentity?: string | null): string {
  if (explicitIdentity?.trim()) return explicitIdentity.trim();
  // Try localStorage as fallback (for when context isn't available).
  // Use globalThis to support both browser (window.localStorage) and test environments
  // where vitest stubs localStorage on globalThis without defining window.
  const storage = (
    typeof window !== 'undefined'
      ? window.localStorage
      : (globalThis as { localStorage?: Storage }).localStorage
  );
  if (storage) {
    try {
      const stored = storage.getItem('relay_username');
      if (stored?.trim()) return stored.trim();
    } catch { /* SSR or blocked */ }
  }
  return 'Dashboard';
}

/**
 * Normalize a name: map Dashboard variants to the project identity.
 * Non-Dashboard names pass through unchanged.
 */
export function normalizeDashboardName(name: string, projectIdentity?: string | null): string {
  if (!name?.trim()) return name;
  if (isDashboardVariant(name.trim())) {
    return getProjectIdentity(projectIdentity);
  }
  return name.trim();
}
