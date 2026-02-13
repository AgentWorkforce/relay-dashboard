/**
 * Slack Integration Panel
 *
 * Manages Slack workspace connections including:
 * - OAuth connect via Nango
 * - Connected workspace list with status
 * - Channel configurations per workspace
 * - Test message sending
 * - Disconnect functionality
 *
 * Design: Follows Mission Control theme consistent with WorkspaceSettingsPanel
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Nango from '@nangohq/frontend';
import { cloudApi } from '../../lib/cloudApi';

export interface SlackIntegrationPanelProps {
  workspaceId: string;
  csrfToken?: string;
}

interface SlackConnection {
  id: string;
  teamId: string;
  teamName: string;
  connectionId: string;
  status: string;
  connectedAt: string;
}

interface SlackChannel {
  id: string;
  channelId: string;
  channelName: string;
  workspaceConnectionId: string;
  allowedRepos?: string[];
  defaultRepo?: string;
}

export function SlackIntegrationPanel({ workspaceId, csrfToken }: SlackIntegrationPanelProps) {
  const [connections, setConnections] = useState<SlackConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // OAuth flow state
  const [isConnecting, setIsConnecting] = useState(false);
  const [oauthConnectionId, setOauthConnectionId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Channel expansion state
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<string, SlackChannel[]>>({});
  const [loadingChannels, setLoadingChannels] = useState<string | null>(null);

  // Test message state
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ connectionId: string; success: boolean; message: string } | null>(null);

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Load connections
  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await cloudApi.getSlackConnections(workspaceId);
    if (result.success) {
      setConnections(result.data.connections);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Start OAuth flow using @nangohq/frontend SDK (same pattern as login/connect-repos)
  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    const result = await cloudApi.createSlackOAuthSession(workspaceId);
    if (!result.success) {
      setError(result.error);
      setIsConnecting(false);
      return;
    }

    const { sessionToken } = result.data;

    try {
      // Use Nango frontend SDK to trigger OAuth (avoids popup blocker issues)
      const nango = new Nango({ connectSessionToken: sessionToken });
      const authResult = await nango.auth('slack');

      if (!authResult || !('connectionId' in authResult)) {
        throw new Error('No connection ID returned from Slack auth');
      }

      const connectionId = authResult.connectionId;
      setOauthConnectionId(connectionId);

      // Poll for backend to finish processing the webhook
      pollIntervalRef.current = setInterval(async () => {
        const statusResult = await cloudApi.checkSlackOAuthStatus(connectionId);
        if (statusResult.success && statusResult.data.ready) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsConnecting(false);
          setOauthConnectionId(null);
          loadConnections();
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setIsConnecting(false);
          setOauthConnectionId(null);
        }
      }, 5 * 60 * 1000);
    } catch (err: unknown) {
      const authError = err as Error & { type?: string };
      // Don't show error for user-cancelled auth
      if (authError.type === 'user_cancelled' || authError.message?.includes('closed')) {
        setIsConnecting(false);
        return;
      }
      setError(authError.message || 'Slack authentication failed');
      setIsConnecting(false);
    }
  }, [workspaceId, loadConnections]);

  // Cancel OAuth flow
  const handleCancelConnect = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsConnecting(false);
    setOauthConnectionId(null);
  }, []);

  // Load channels for a connection
  const handleToggleChannels = useCallback(async (connection: SlackConnection) => {
    if (expandedConnection === connection.connectionId) {
      setExpandedConnection(null);
      return;
    }

    setExpandedConnection(connection.connectionId);

    // Only fetch if not already loaded
    if (!channels[connection.connectionId]) {
      setLoadingChannels(connection.connectionId);
      const result = await cloudApi.getSlackChannels(connection.connectionId);
      if (result.success) {
        setChannels(prev => ({
          ...prev,
          [connection.connectionId]: result.data.channels,
        }));
      }
      setLoadingChannels(null);
    }
  }, [expandedConnection, channels]);

  // Send test message
  const handleTestMessage = useCallback(async (connectionId: string) => {
    setSendingTest(connectionId);
    setTestResult(null);

    const result = await cloudApi.sendSlackTestMessage(connectionId);
    if (result.success) {
      setTestResult({
        connectionId,
        success: true,
        message: result.data.message || 'Test message sent successfully',
      });
    } else {
      setTestResult({
        connectionId,
        success: false,
        message: result.error,
      });
    }
    setSendingTest(null);
  }, []);

  // Disconnect workspace
  const handleDisconnect = useCallback(async (connection: SlackConnection) => {
    const confirmed = window.confirm(
      `Are you sure you want to disconnect "${connection.teamName}"? This will stop all Slack integrations for this workspace.`
    );
    if (!confirmed) return;

    setDisconnecting(connection.id);
    setError(null);

    const result = await cloudApi.disconnectSlackWorkspace(connection.id);
    if (result.success) {
      setConnections(prev => prev.filter(c => c.id !== connection.id));
      // Clean up expanded/channel state
      if (expandedConnection === connection.connectionId) {
        setExpandedConnection(null);
      }
      setChannels(prev => {
        const updated = { ...prev };
        delete updated[connection.connectionId];
        return updated;
      });
    } else {
      setError(result.error);
    }
    setDisconnecting(null);
  }, [expandedConnection]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-accent-cyan/40 animate-pulse" />
          </div>
        </div>
        <span className="ml-4 text-text-muted font-mono text-sm tracking-wide">
          LOADING SLACK CONNECTIONS...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">
            Slack Integration
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Connect Slack workspaces to enable AI-powered conversations
          </p>
        </div>
        <SlackLogo />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex items-center gap-3">
          <AlertIcon />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-error/60 hover:text-error">
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Connected Workspaces */}
      {connections.length > 0 && (
        <div className="space-y-3">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="bg-bg-tertiary rounded-xl border border-border-subtle overflow-hidden transition-all duration-200 hover:border-border-medium"
            >
              {/* Connection header */}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[#4A154B] flex items-center justify-center shadow-lg shadow-[#4A154B]/30">
                      <SlackMark />
                    </div>
                    <div>
                      <h4 className="text-base font-semibold text-text-primary">
                        {connection.teamName}
                      </h4>
                      <p className="text-xs text-text-muted mt-0.5">
                        Connected {new Date(connection.connectedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Status badge */}
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${
                      connection.status === 'active'
                        ? 'bg-success/15 border-success/30'
                        : connection.status === 'error'
                        ? 'bg-error/15 border-error/30'
                        : 'bg-amber-400/15 border-amber-400/30'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        connection.status === 'active'
                          ? 'bg-success animate-pulse'
                          : connection.status === 'error'
                          ? 'bg-error'
                          : 'bg-amber-400'
                      }`} />
                      <span className={`text-sm font-medium ${
                        connection.status === 'active'
                          ? 'text-success'
                          : connection.status === 'error'
                          ? 'text-error'
                          : 'text-amber-400'
                      }`}>
                        {connection.status.charAt(0).toUpperCase() + connection.status.slice(1)}
                      </span>
                    </div>

                    {/* Disconnect */}
                    <button
                      onClick={() => handleDisconnect(connection)}
                      disabled={disconnecting === connection.id}
                      className="px-3 py-2 text-xs font-medium text-error/80 hover:text-error hover:bg-error/10 rounded-lg border border-transparent hover:border-error/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Disconnect ${connection.teamName}`}
                    >
                      {disconnecting === connection.id ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-border-subtle">
                  {/* View channels */}
                  <button
                    onClick={() => handleToggleChannels(connection)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                      expandedConnection === connection.connectionId
                        ? 'bg-accent-cyan/15 border border-accent-cyan/30 text-accent-cyan'
                        : 'bg-bg-card border border-border-subtle text-text-secondary hover:border-accent-cyan/30 hover:text-accent-cyan'
                    }`}
                  >
                    <ChannelIcon />
                    {expandedConnection === connection.connectionId ? 'Hide Channels' : 'View Channels'}
                    <ChevronIcon expanded={expandedConnection === connection.connectionId} />
                  </button>

                  {/* Test message */}
                  <button
                    onClick={() => handleTestMessage(connection.id)}
                    disabled={sendingTest === connection.id}
                    className="flex items-center gap-2 px-4 py-2 bg-bg-card border border-border-subtle rounded-lg text-xs font-semibold text-text-secondary hover:border-accent-cyan/30 hover:text-accent-cyan transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <MessageIcon />
                    {sendingTest === connection.id ? 'Sending...' : 'Send Test'}
                  </button>
                </div>

                {/* Test result */}
                {testResult && testResult.connectionId === connection.id && (
                  <div className={`mt-3 p-3 rounded-lg text-xs ${
                    testResult.success
                      ? 'bg-success/10 border border-success/30 text-success'
                      : 'bg-error/10 border border-error/30 text-error'
                  }`}>
                    {testResult.message}
                  </div>
                )}
              </div>

              {/* Channels section (collapsible) */}
              {expandedConnection === connection.connectionId && (
                <div className="border-t border-border-subtle bg-bg-primary/50 p-4">
                  {loadingChannels === connection.connectionId ? (
                    <div className="flex items-center gap-3 py-4 justify-center">
                      <div className="w-5 h-5 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin" />
                      <span className="text-xs text-text-muted">Loading channels...</span>
                    </div>
                  ) : (channels[connection.connectionId]?.length ?? 0) > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-3">
                        Configured Channels ({channels[connection.connectionId]?.length})
                      </p>
                      {channels[connection.connectionId]?.map((channel) => (
                        <div
                          key={channel.id}
                          className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-subtle"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-bg-card flex items-center justify-center">
                              <span className="text-text-muted text-sm">#</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                #{channel.channelName}
                              </p>
                              {channel.defaultRepo && (
                                <p className="text-xs text-text-muted">
                                  Default repo: {channel.defaultRepo}
                                </p>
                              )}
                            </div>
                          </div>
                          {channel.allowedRepos && channel.allowedRepos.length > 0 && (
                            <span className="text-xs text-text-muted bg-bg-card px-2 py-1 rounded">
                              {channel.allowedRepos.length} repo{channel.allowedRepos.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <ChannelIcon className="w-8 h-8 mx-auto mb-2 text-text-muted" />
                      <p className="text-sm text-text-muted">No channels configured yet</p>
                      <p className="text-xs text-text-muted mt-1">
                        Invite the bot to a Slack channel to get started
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Connect button / OAuth flow */}
      {isConnecting ? (
        <div className="p-6 bg-bg-tertiary rounded-xl border border-accent-cyan/30 text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin" />
            <span className="text-sm text-text-primary font-medium">
              Waiting for Slack authorization...
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Complete the authorization in the popup window. This page will update automatically.
          </p>
          <button
            onClick={handleCancelConnect}
            className="px-4 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          className="w-full py-4 px-6 bg-gradient-to-r from-[#4A154B] to-[#611F69] text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-[#4A154B]/30 hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-3"
        >
          <SlackMark />
          {connections.length > 0 ? 'Connect Another Workspace' : 'Connect Slack Workspace'}
        </button>
      )}

      {/* Empty state */}
      {connections.length === 0 && !isConnecting && (
        <div className="p-6 bg-bg-tertiary/50 rounded-xl border border-border-subtle border-dashed text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#4A154B]/20 flex items-center justify-center mx-auto mb-4">
            <SlackMark className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-semibold text-text-primary mb-2">
            No Slack Workspaces Connected
          </h4>
          <p className="text-xs text-text-muted max-w-sm mx-auto">
            Connect your Slack workspace to enable AI-powered conversations directly in your channels.
            Agents can help with code reviews, PRD generation, and more.
          </p>
        </div>
      )}
    </div>
  );
}

// Icons

function SlackLogo() {
  return (
    <div className="w-10 h-10 rounded-xl bg-[#4A154B]/20 flex items-center justify-center">
      <SlackMark />
    </div>
  );
}

function SlackMark({ className = '' }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChannelIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 3L8 21" />
      <path d="M16 3l-2 18" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
