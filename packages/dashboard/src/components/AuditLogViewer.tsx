/**
 * Audit Log Viewer Component
 *
 * Displays integration proxy audit logs with filtering and pagination.
 * Part of the Unified Agent Auth feature (Phase 3).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cloudApi } from '../lib/cloudApi';

export interface AuditLogViewerProps {
  workspaceId: string;
  className?: string;
}

interface AuditEntry {
  id: string;
  provider: string;
  agentName: string | null;
  taskId: string | null;
  method: string;
  endpoint: string;
  statusCode: number;
  responseTimeMs: number;
  createdAt: string;
}

interface AuditFilters {
  provider: string;
  agent: string;
  startTime: string;
  endTime: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  github: '#24292e',
  slack: '#4A154B',
  linear: '#5E6AD2',
  jira: '#0052CC',
  notion: '#000000',
  gmail: '#EA4335',
  datadog: '#632CA6',
  sentry: '#362D59',
  vercel: '#000000',
  netlify: '#00C7B7',
};

/**
 * Format relative time from ISO timestamp
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Get status color based on HTTP status code
 */
function getStatusColor(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return 'text-success';
  if (statusCode >= 400 && statusCode < 500) return 'text-amber-400';
  return 'text-error';
}

/**
 * Get method color for HTTP methods
 */
function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-accent-cyan';
    case 'POST': return 'text-success';
    case 'PUT': case 'PATCH': return 'text-amber-400';
    case 'DELETE': return 'text-error';
    default: return 'text-text-muted';
  }
}

export function AuditLogViewer({ workspaceId, className = '' }: AuditLogViewerProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<AuditFilters>({
    provider: '',
    agent: '',
    startTime: '',
    endTime: '',
  });

  // Fetch audit entries
  const fetchEntries = useCallback(async (reset = false) => {
    setIsLoading(true);
    setError(null);

    const params: Record<string, string> = { limit: '50' };
    if (filters.provider) params.provider = filters.provider;
    if (filters.agent) params.agent = filters.agent;
    if (filters.startTime) params.startTime = new Date(filters.startTime).toISOString();
    if (filters.endTime) params.endTime = new Date(filters.endTime).toISOString();
    if (!reset && cursor) params.cursor = cursor;

    const result = await cloudApi.getAuditLogs(workspaceId, params);

    if (result.success) {
      const newEntries = result.data.entries;
      setEntries(prev => reset ? newEntries : [...prev, ...newEntries]);
      setCursor(result.data.cursor || null);
      setHasMore(result.data.hasMore);
    } else {
      setError(result.error);
    }

    setIsLoading(false);
  }, [workspaceId, filters, cursor]);

  // Initial load
  useEffect(() => {
    fetchEntries(true);
  }, [workspaceId]);

  // Apply filters
  const handleApplyFilters = () => {
    setCursor(null);
    fetchEntries(true);
    setShowFilters(false);
  };

  // Clear filters
  const handleClearFilters = () => {
    setFilters({ provider: '', agent: '', startTime: '', endTime: '' });
    setCursor(null);
    fetchEntries(true);
    setShowFilters(false);
  };

  // Load more entries
  const handleLoadMore = () => {
    if (hasMore && !isLoading) {
      fetchEntries(false);
    }
  };

  const activeFilterCount = [filters.provider, filters.agent, filters.startTime, filters.endTime].filter(Boolean).length;

  return (
    <div className={`bg-bg-tertiary rounded-xl border border-border-subtle overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-gradient-to-r from-bg-tertiary to-bg-secondary">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent-purple/20 flex items-center justify-center">
            <AuditIcon className="text-accent-purple" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Audit Log</h3>
            <p className="text-xs text-text-muted">Integration proxy request history</p>
          </div>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            showFilters || activeFilterCount > 0
              ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30'
              : 'bg-bg-card text-text-secondary hover:bg-bg-hover border border-border-subtle'
          }`}
        >
          <FilterIcon />
          Filters
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 bg-accent-cyan/30 rounded-full text-[10px]">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="px-5 py-4 border-b border-border-subtle bg-bg-secondary/50">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1.5">Provider</label>
              <select
                value={filters.provider}
                onChange={(e) => setFilters(prev => ({ ...prev, provider: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
              >
                <option value="">All providers</option>
                <option value="github">GitHub</option>
                <option value="slack">Slack</option>
                <option value="linear">Linear</option>
                <option value="jira">Jira</option>
                <option value="gmail">Gmail</option>
                <option value="notion">Notion</option>
                <option value="datadog">Datadog</option>
                <option value="sentry">Sentry</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1.5">Agent</label>
              <input
                type="text"
                value={filters.agent}
                onChange={(e) => setFilters(prev => ({ ...prev, agent: e.target.value }))}
                placeholder="Filter by agent name"
                className="w-full px-3 py-2 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1.5">Start Time</label>
              <input
                type="datetime-local"
                value={filters.startTime}
                onChange={(e) => setFilters(prev => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1.5">End Time</label>
              <input
                type="datetime-local"
                value={filters.endTime}
                onChange={(e) => setFilters(prev => ({ ...prev, endTime: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-accent-cyan text-bg-deep font-medium rounded-lg text-sm hover:bg-accent-cyan/90 transition-colors"
            >
              Apply Filters
            </button>
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 bg-bg-card text-text-secondary font-medium rounded-lg text-sm hover:bg-bg-hover border border-border-subtle transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="px-5 py-4 bg-error/10 border-b border-error/30">
          <div className="flex items-center gap-2 text-error text-sm">
            <AlertIcon />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-secondary/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Agent</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Provider</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Request</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-bg-hover/50 transition-colors">
                <td className="px-4 py-3">
                  <span className="text-xs text-text-muted" title={new Date(entry.createdAt).toLocaleString()}>
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-text-primary font-medium">
                    {entry.agentName || <span className="text-text-muted italic">Unknown</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-white"
                    style={{ backgroundColor: PROVIDER_COLORS[entry.provider] || '#6B7280' }}
                  >
                    {entry.provider}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${getMethodColor(entry.method)}`}>
                      {entry.method}
                    </span>
                    <span className="text-sm text-text-secondary font-mono truncate max-w-[300px]" title={entry.endpoint}>
                      {entry.endpoint}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-sm font-mono font-bold ${getStatusColor(entry.statusCode)}`}>
                    {entry.statusCode}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-xs text-text-muted font-mono">
                    {entry.responseTimeMs}ms
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty State */}
      {!isLoading && entries.length === 0 && (
        <div className="px-5 py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-bg-card mx-auto mb-3 flex items-center justify-center">
            <AuditIcon className="text-text-muted" />
          </div>
          <p className="text-sm text-text-muted">No audit entries found</p>
          <p className="text-xs text-text-muted mt-1">
            {activeFilterCount > 0 ? 'Try adjusting your filters' : 'Integration requests will appear here'}
          </p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && entries.length === 0 && (
        <div className="px-5 py-12 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading audit logs...</p>
        </div>
      )}

      {/* Load More */}
      {hasMore && !isLoading && entries.length > 0 && (
        <div className="px-5 py-4 border-t border-border-subtle">
          <button
            onClick={handleLoadMore}
            className="w-full py-2.5 bg-bg-card text-text-secondary font-medium rounded-lg text-sm hover:bg-bg-hover border border-border-subtle transition-colors"
          >
            Load More
          </button>
        </div>
      )}

      {/* Loading More */}
      {isLoading && entries.length > 0 && (
        <div className="px-5 py-4 border-t border-border-subtle text-center">
          <span className="text-xs text-text-muted">Loading more...</span>
        </div>
      )}
    </div>
  );
}

// Icons
function AuditIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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
