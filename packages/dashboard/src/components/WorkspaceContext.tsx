/**
 * Workspace Context
 *
 * Provides the current workspace's base URL for WebSocket connections.
 * Used by LogViewer and other components that need to connect to workspace-specific endpoints.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { getWebSocketUrl } from '../lib/config';

interface WorkspaceContextValue {
  /** Base WebSocket URL for the workspace (e.g., wss://workspace-abc.agentrelay.dev) */
  wsBaseUrl: string | null;
  /** Whether we're in cloud mode (workspace URL is different from page host) */
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
  const value = useMemo(() => {
    if (!wsUrl) {
      return { wsBaseUrl: null, isCloudMode: false };
    }

    const wsBaseUrl = getBaseUrl(wsUrl);

    // Check if we're in cloud mode by comparing the workspace URL host with the current page host
    let isCloudMode = false;
    if (typeof window !== 'undefined') {
      try {
        const wsHost = new URL(wsUrl).host;
        isCloudMode = wsHost !== window.location.host;
      } catch {
        // Ignore parse errors
      }
    }

    return { wsBaseUrl, isCloudMode };
  }, [wsUrl]);

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
