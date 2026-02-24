/**
 * Unified identity resolution module.
 *
 * Consolidates identity concerns from relaycast-provider-helpers,
 * proxy-server, and utils into a single stateless module.
 *
 * All functions accept an explicit IdentityConfig instead of relying on
 * module-level state.
 */

import { isBrokerIdentity as isBrokerIdentityContract } from '@agent-relay/contracts';
import { DASHBOARD_DISPLAY_NAME, DASHBOARD_READER_NAME } from '../relaycast-provider-types.js';

export interface IdentityConfig {
  /** Project identity derived from dashboard runtime context. */
  projectIdentity: string;
  /** Relay agent display name (config.agentName), when relevant. */
  relayAgentName?: string;
  /** Additional identities that should be treated as broker aliases. */
  brokerIdentities?: string[];
}

/**
 * Simple name normalization -- lowercases and trims.
 */
export function normalizeName(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

/**
 * Dashboard variant detection.
 *
 * Matches:
 * - "Dashboard" (exact, case-insensitive)
 * - "dashboard-reader"
 * - "Dashboard-<hex>" (Relaycast conflict suffix, e.g. Dashboard-5b8c70e5)
 * - "human:dashboard"
 */
export function isDashboardVariant(name: string): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();

  if (lowered === DASHBOARD_DISPLAY_NAME.toLowerCase()) return true;
  if (lowered === DASHBOARD_READER_NAME) return true;
  if (lowered === 'human:dashboard') return true;
  if (/^dashboard-[0-9a-f]{6,}$/i.test(trimmed)) return true;

  return false;
}

/**
 * Broker identity check.
 *
 * Delegates to `@agent-relay/contracts` isBrokerIdentity for standard broker
 * names ("broker" or "broker-*"), and also checks explicit aliases provided
 * by config.
 */
export function isBrokerIdentity(name: string, config: IdentityConfig): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return false;

  if (isBrokerIdentityContract(trimmed)) return true;

  const normalized = normalizeName(trimmed);
  const aliases = new Set<string>();

  const addAlias = (value: string | undefined): void => {
    const alias = normalizeName(value ?? '');
    if (alias) {
      aliases.add(alias);
    }
  };

  addAlias(config.projectIdentity);

  if (Array.isArray(config.brokerIdentities)) {
    for (const identity of config.brokerIdentities) {
      addAlias(identity);
    }
  }

  return aliases.has(normalized);
}

/**
 * Full identity resolution.
 *
 * Maps Dashboard variants, broker names, and project-identity aliases back to
 * the canonical `projectIdentity` (or `DASHBOARD_DISPLAY_NAME` when no project
 * identity is configured).
 *
 * Replaces both `normalizeIdentity()` and `resolveRelaycastSenderName()`.
 */
export function resolveIdentity(name: string, config: IdentityConfig): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';

  const fallback = dashboardDisplayName(config);

  // Dashboard variant -> project identity
  if (isDashboardVariant(trimmed)) {
    return fallback;
  }

  // Broker identity -> project identity
  if (isBrokerIdentity(trimmed, config)) {
    return fallback;
  }

  // Project identity itself (case-insensitive match) -> canonical casing
  const lowered = normalizeName(trimmed);
  const projectValue = config.projectIdentity?.trim();
  const projectKey = normalizeName(projectValue ?? '');
  if (projectKey && lowered === projectKey) {
    return projectValue ?? '';
  }

  // Relay agent name -> project identity
  const relayKey = normalizeName(config.relayAgentName ?? '');
  if (relayKey && lowered === relayKey) {
    return fallback;
  }

  return trimmed;
}

/**
 * Canonical display name for the dashboard given current config.
 */
export function dashboardDisplayName(config: IdentityConfig): string {
  return config.projectIdentity?.trim()
    || config.relayAgentName?.trim()
    || DASHBOARD_DISPLAY_NAME;
}
