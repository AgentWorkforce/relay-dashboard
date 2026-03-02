/**
 * Workspace Context
 *
 * Provides the current workspace's base URL for WebSocket connections.
 * Used by LogViewer and other components that need to connect to workspace-specific endpoints.
 * Cloud mode is sourced from DashboardConfig instead of runtime hostname/env detection.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useDashboardConfig } from '../adapters';
import { getWebSocketUrl } from '../lib/config';

interface WorkspaceContextValue {
  /** Base WebSocket URL for the workspace (e.g., wss://workspace-abc.agentrelay.dev) */
  wsBaseUrl: string | null;
  /** Whether cloud mode is enabled in dashboard configuration */
  isCloudMode: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  wsBaseUrl: null,
  isCloudMode: false,
});

export interface WorkspaceProviderProps {
  children: React.ReactNode;
  /** The workspace WebSocket URL (e.g., wss://workspace-abc.agentrelay.dev/ws) */
  wsUrl?: string;
}

/**
 * Extract base URL from a WebSocket URL
 * e.g., wss://workspace-abc.agentrelay.dev/ws -> wss://workspace-abc.agentrelay.dev
 */
function getBaseUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return wsUrl;
  }
}

export function WorkspaceProvider({ children, wsUrl }: WorkspaceProviderProps) {
  const { isCloudMode } = useDashboardConfig();

  const value = useMemo(() => {
    const wsBaseUrl = wsUrl ? getBaseUrl(wsUrl) : null;
    return { wsBaseUrl, isCloudMode };
  }, [wsUrl, isCloudMode]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * Hook to access the workspace context
 */
export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}

/**
 * Get the WebSocket URL for a specific path within the workspace
 * Falls back to centralized config if not in a workspace context
 */
export function useWorkspaceWsUrl(path: string): string {
  const { wsBaseUrl } = useWorkspace();

  return useMemo(() => {
    if (wsBaseUrl) {
      return `${wsBaseUrl}${path}`;
    }

    // Fallback to centralized config
    return getWebSocketUrl(path);
  }, [wsBaseUrl, path]);
}

export default WorkspaceContext;
