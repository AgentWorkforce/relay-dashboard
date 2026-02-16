/**
 * Dashboard V2 - Main Entry Point
 *
 * Exports all utilities, components, and types for the v2 dashboard.
 */

// Types
export * from './types/index.js';

// Color coding utilities
export {
  getAgentColor,
  getAgentPrefix,
  getAgentInitials,
  parseAgentHierarchy,
  groupAgentsByPrefix,
  sortAgentsByHierarchy,
  getAgentColorVars,
  STATUS_COLORS,
  type ColorScheme,
  type AgentStatus,
} from './lib/colors.js';

// Hierarchy utilities
export {
  buildAgentTree,
  flattenTree,
  groupAgents,
  getAgentDisplayName,
  getAgentBreadcrumb,
  matchesSearch,
  filterAgents,
  getGroupStats,
  type HierarchyNode,
  type AgentGroup,
} from './lib/hierarchy.js';

// API utilities
export {
  api,
  DashboardWebSocket,
  getWebSocket,
  type DashboardData,
} from './lib/api.js';

// Reaction components
export { ReactionChips } from './components/ReactionChips.js';
export { ReactionPicker } from './components/ReactionPicker.js';

// Thread hook
export { useThread } from './components/hooks/useThread.js';

// React Components
// These require React to be installed. For Next.js consumers, use
// transpilePackages: ['@agent-relay/dashboard'] and import from
// '@agent-relay/dashboard/components/App' etc.
export { App } from './components/App.js';
export type { AppProps } from './components/App.js';
export { MessageList } from './components/MessageList.js';
export { ThreadPanel } from './components/ThreadPanel.js';

// Config
export { config, getWebSocketUrl, getApiBaseUrl } from './lib/config.js';
