/**
 * useChannelBrowser Hook
 *
 * Manages browsing, searching, and joining channels.
 * Includes debounced search and pagination support.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from './useDebounce';
import { listChannels, joinChannel as joinChannelApi, leaveChannel as leaveChannelApi } from '../channels/api';

export interface BrowseChannel {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  isJoined: boolean;
  isPrivate: boolean;
  createdAt: string;
}

export interface UseChannelBrowserOptions {
  /** Workspace ID (required for API calls) */
  workspaceId: string;
  /** Initial page size (default: 20) */
  pageSize?: number;
  /** Search debounce delay in ms (default: 300) */
  debounceDelay?: number;
  /** Auto-fetch on mount (default: true) */
  autoFetch?: boolean;
}

export interface UseChannelBrowserReturn {
  /** List of channels for current page */
  channels: BrowseChannel[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Current search query */
  searchQuery: string;
  /** Update search query */
  setSearchQuery: (query: string) => void;
  /** Current page (1-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Total count of channels matching search */
  totalCount: number;
  /** Navigate to a specific page */
  goToPage: (page: number) => void;
  /** Join a channel */
  joinChannel: (channelId: string) => Promise<void>;
  /** Leave a channel */
  leaveChannel: (channelId: string) => Promise<void>;
  /** Refresh the channel list */
  refresh: () => void;
}

export function useChannelBrowser(
  options: UseChannelBrowserOptions
): UseChannelBrowserReturn {
  const {
    workspaceId,
    pageSize = 20,
    debounceDelay = 300,
    autoFetch = true,
  } = options;

  const [channels, setChannels] = useState<BrowseChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, debounceDelay);

  // Calculate total pages
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  // Fetch channels from API (workspace-scoped)
  const fetchChannels = useCallback(async (page: number, search: string) => {
    if (!workspaceId) {
      setError('Workspace ID is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await listChannels(workspaceId, { joinedOnly: false });
      const normalizedSearch = search.trim().toLowerCase();

      // Show only channels the user has not yet joined.
      const availableChannels = result.channels
        .filter((ch) => ch.status !== 'archived')
        .map((ch): BrowseChannel => ({
          id: ch.id,
          name: ch.name,
          description: ch.description,
          memberCount: ch.memberCount || 0,
          isJoined: ch.isJoined ?? false,
          isPrivate: ch.visibility === 'private',
          createdAt: ch.createdAt,
        }))
        .filter((ch) => !ch.isJoined);

      const filteredChannels = normalizedSearch
        ? availableChannels.filter((ch) =>
          ch.name.toLowerCase().includes(normalizedSearch) ||
          ch.description?.toLowerCase().includes(normalizedSearch)
        )
        : availableChannels;

      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      setChannels(filteredChannels.slice(start, end));
      setTotalCount(filteredChannels.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch channels';
      setError(message);
      console.error('[useChannelBrowser] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, pageSize]);

  // Fetch when search or page changes
  useEffect(() => {
    if (autoFetch) {
      fetchChannels(currentPage, debouncedSearchQuery);
    }
  }, [currentPage, debouncedSearchQuery, autoFetch, fetchChannels]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery]);

  // Go to specific page
  const goToPage = useCallback((page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  }, [totalPages]);

  // Join a channel (workspace-scoped)
  const joinChannel = useCallback(async (channelId: string) => {
    if (!workspaceId) {
      throw new Error('Workspace ID is required');
    }

    try {
      await joinChannelApi(workspaceId, channelId);

      // Remove from browse list once joined.
      setChannels((prev) => prev.filter((ch) => ch.id !== channelId));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join channel';
      setError(message);
      throw err;
    }
  }, [workspaceId]);

  // Leave a channel (workspace-scoped)
  const leaveChannel = useCallback(async (channelId: string) => {
    if (!workspaceId) {
      throw new Error('Workspace ID is required');
    }

    try {
      await leaveChannelApi(workspaceId, channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to leave channel';
      setError(message);
      throw err;
    }
  }, [workspaceId]);

  // Refresh current view
  const refresh = useCallback(() => {
    fetchChannels(currentPage, debouncedSearchQuery);
  }, [fetchChannels, currentPage, debouncedSearchQuery]);

  return {
    channels,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    currentPage,
    totalPages,
    totalCount,
    goToPage,
    joinChannel,
    leaveChannel,
    refresh,
  };
}
