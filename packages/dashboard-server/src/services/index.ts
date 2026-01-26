/**
 * Services Index
 *
 * Re-exports all service modules for the dashboard server.
 */

export { UserBridge, type IRelayClient } from './user-bridge.js';
export { computeNeedsAttention, type AttentionMessage } from './needs-attention.js';
export {
  computeSystemMetrics,
  formatPrometheusMetrics,
  type AgentMetrics,
  type ThroughputMetrics,
  type SessionMetrics,
  type SystemMetrics,
} from './metrics.js';
export { HealthWorkerManager, getHealthPort, type HealthWorkerConfig, type HealthStatsProvider } from './health-worker-manager.js';
