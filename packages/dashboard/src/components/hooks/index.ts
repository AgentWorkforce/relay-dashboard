/**
 * Dashboard V2 React Hooks
 */

export { useWebSocket, type UseWebSocketOptions, type UseWebSocketReturn, type DashboardData, type ConnectionState, type WebSocketEvent } from './useWebSocket';
export { useAgents, type UseAgentsOptions, type UseAgentsReturn, type AgentWithColor } from './useAgents';
export { useMessages, type UseMessagesOptions, type UseMessagesReturn } from './useMessages';
export {
  useOrchestrator,
  type UseOrchestratorOptions,
  type UseOrchestratorResult,
  type OrchestratorAgent,
  type OrchestratorEvent,
} from './useOrchestrator';
export { useAgentLogs, type UseAgentLogsOptions, type UseAgentLogsReturn, type LogLine, type LogConnectionState } from './useAgentLogs';
export { useTrajectory } from './useTrajectory';
export {
  useRecentRepos,
  type UseRecentReposOptions,
  type UseRecentReposReturn,
  type RecentRepo,
} from './useRecentRepos';
export {
  useWorkspaceRepos,
  type UseWorkspaceReposOptions,
  type UseWorkspaceReposReturn,
  type WorkspaceRepo,
} from './useWorkspaceRepos';
export {
  useChannels,
  type UseChannelsOptions,
  type UseChannelsReturn,
  type ChannelMessage,
  type ChannelConnectionState,
} from './useChannels';
export {
  usePinnedAgents,
  type UsePinnedAgentsReturn,
} from './usePinnedAgents';
