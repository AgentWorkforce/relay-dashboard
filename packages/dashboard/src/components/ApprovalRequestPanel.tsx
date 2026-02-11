/**
 * Approval Request Panel Component
 *
 * Displays pending integration access requests from agents.
 * Part of the Unified Agent Auth feature (Phase 3 - Human-in-the-Loop).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cloudApi } from '../lib/cloudApi';

export interface ApprovalRequestPanelProps {
  workspaceId: string;
  className?: string;
  onApprovalChange?: () => void;
}

interface ApprovalRequest {
  id: string;
  provider: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  scopes: string[];
  reason: string | null;
  approvedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

const PROVIDER_INFO: Record<string, { name: string; color: string; icon: string }> = {
  github: { name: 'GitHub', color: '#24292e', icon: 'GH' },
  slack: { name: 'Slack', color: '#4A154B', icon: 'SL' },
  linear: { name: 'Linear', color: '#5E6AD2', icon: 'LI' },
  jira: { name: 'Jira', color: '#0052CC', icon: 'JI' },
  notion: { name: 'Notion', color: '#000000', icon: 'NO' },
  gmail: { name: 'Gmail', color: '#EA4335', icon: 'GM' },
  datadog: { name: 'Datadog', color: '#632CA6', icon: 'DD' },
  sentry: { name: 'Sentry', color: '#362D59', icon: 'SE' },
  vercel: { name: 'Vercel', color: '#000000', icon: 'VE' },
  netlify: { name: 'Netlify', color: '#00C7B7', icon: 'NE' },
  salesforce: { name: 'Salesforce', color: '#00A1E0', icon: 'SF' },
};

/**
 * Format relative time from ISO timestamp
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

/**
 * Format time until expiry
 */
function formatTimeUntilExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  
  if (diffMs <= 0) return 'Expired';
  
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 1) return 'Expires soon';
  if (diffHours < 24) return `Expires in ${diffHours}h`;
  return `Expires in ${Math.floor(diffHours / 24)}d`;
}

export function ApprovalRequestPanel({ 
  workspaceId, 
  className = '',
  onApprovalChange 
}: ApprovalRequestPanelProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Fetch pending approval requests
  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await cloudApi.getApprovalRequests(workspaceId);

    if (result.success) {
      setRequests(result.data.requests);
    } else {
      setError(result.error);
    }

    setIsLoading(false);
  }, [workspaceId]);

  // Initial load and polling
  useEffect(() => {
    fetchRequests();
    // Poll every 30 seconds for new requests
    const interval = setInterval(fetchRequests, 30000);
    return () => clearInterval(interval);
  }, [fetchRequests]);

  // Handle approval
  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);

    const result = await cloudApi.approveRequest(workspaceId, requestId);

    if (result.success) {
      setRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'approved' as const } : r
      ));
      onApprovalChange?.();
    } else {
      setError(result.error);
    }

    setProcessingId(null);
  };

  // Handle denial
  const handleDeny = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);

    const result = await cloudApi.denyRequest(workspaceId, requestId);

    if (result.success) {
      setRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'denied' as const } : r
      ));
      onApprovalChange?.();
    } else {
      setError(result.error);
    }

    setProcessingId(null);
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const recentRequests = requests.filter(r => r.status !== 'pending').slice(0, 5);

  return (
    <div className={`bg-bg-tertiary rounded-xl border border-border-subtle overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-gradient-to-r from-bg-tertiary to-bg-secondary">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center relative">
            <BellIcon className="text-amber-400" />
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 text-bg-deep text-[10px] font-bold rounded-full flex items-center justify-center">
                {pendingRequests.length}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Access Requests</h3>
            <p className="text-xs text-text-muted">
              {pendingRequests.length > 0 
                ? `${pendingRequests.length} pending approval${pendingRequests.length > 1 ? 's' : ''}`
                : 'No pending requests'}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchRequests()}
          disabled={isLoading}
          className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshIcon spinning={isLoading} />
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="px-5 py-3 bg-error/10 border-b border-error/30">
          <div className="flex items-center gap-2 text-error text-sm">
            <AlertIcon />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {pendingRequests.map((request) => {
            const providerInfo = PROVIDER_INFO[request.provider] || { 
              name: request.provider, 
              color: '#6B7280', 
              icon: request.provider.slice(0, 2).toUpperCase() 
            };
            const expiryText = formatTimeUntilExpiry(request.expiresAt);

            return (
              <div key={request.id} className="p-5 bg-amber-400/5">
                <div className="flex items-start gap-4">
                  {/* Provider Icon */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
                    style={{ backgroundColor: providerInfo.color }}
                  >
                    {providerInfo.icon}
                  </div>

                  {/* Request Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-text-primary">
                        {request.requestedBy}
                      </span>
                      <span className="text-xs text-text-muted">requests access to</span>
                      <span className="text-sm font-semibold text-text-primary">
                        {providerInfo.name}
                      </span>
                    </div>

                    {/* Scopes */}
                    <div className="flex items-center gap-2 mb-2">
                      {request.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-0.5 bg-bg-card border border-border-subtle rounded text-xs text-text-secondary"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>

                    {/* Reason */}
                    {request.reason && (
                      <p className="text-sm text-text-secondary mb-2 italic">
                        &ldquo;{request.reason}&rdquo;
                      </p>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span>{formatRelativeTime(request.createdAt)}</span>
                      {expiryText && (
                        <span className={expiryText === 'Expired' ? 'text-error' : 'text-amber-400'}>
                          {expiryText}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDeny(request.id)}
                      disabled={processingId === request.id}
                      className="px-3 py-2 bg-bg-card border border-border-subtle text-text-secondary text-sm font-medium rounded-lg hover:bg-error/10 hover:border-error/30 hover:text-error transition-all disabled:opacity-50"
                    >
                      Deny
                    </button>
                    <button
                      onClick={() => handleApprove(request.id)}
                      disabled={processingId === request.id}
                      className="px-3 py-2 bg-success/15 border border-success/30 text-success text-sm font-medium rounded-lg hover:bg-success/25 transition-all disabled:opacity-50"
                    >
                      {processingId === request.id ? 'Processing...' : 'Approve'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State for Pending */}
      {!isLoading && pendingRequests.length === 0 && (
        <div className="px-5 py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-bg-card mx-auto mb-3 flex items-center justify-center">
            <CheckCircleIcon className="text-success" />
          </div>
          <p className="text-sm text-text-muted">No pending access requests</p>
          <p className="text-xs text-text-muted mt-1">
            Agents will request access when they need new integrations
          </p>
        </div>
      )}

      {/* Recent Requests */}
      {recentRequests.length > 0 && (
        <div className="border-t border-border-subtle">
          <div className="px-5 py-3 bg-bg-secondary/30">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Recent Activity
            </h4>
          </div>
          <div className="divide-y divide-border-subtle">
            {recentRequests.map((request) => {
              const providerInfo = PROVIDER_INFO[request.provider] || { 
                name: request.provider, 
                color: '#6B7280', 
                icon: request.provider.slice(0, 2).toUpperCase() 
              };

              return (
                <div key={request.id} className="px-5 py-3 flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center text-white font-bold text-[10px] shrink-0"
                    style={{ backgroundColor: providerInfo.color }}
                  >
                    {providerInfo.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary">
                      {request.requestedBy}
                    </span>
                    <span className="text-sm text-text-muted mx-1.5">→</span>
                    <span className="text-sm text-text-primary">
                      {providerInfo.name}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    request.status === 'approved' 
                      ? 'bg-success/15 text-success'
                      : request.status === 'denied'
                      ? 'bg-error/15 text-error'
                      : 'bg-text-muted/15 text-text-muted'
                  }`}>
                    {request.status}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatRelativeTime(request.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && requests.length === 0 && (
        <div className="px-5 py-8 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading requests...</p>
        </div>
      )}
    </div>
  );
}

// Icons
function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
