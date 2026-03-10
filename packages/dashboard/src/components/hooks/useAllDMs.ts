/**
 * useAllDMs Hook
 *
 * Fetches ALL DM conversations in the workspace using the workspace-level API
 * (`allDmConversations`). Unlike the SDK's built-in `useDMs` which only returns
 * conversations the dashboard agent participates in, this hook returns agent-to-agent
 * DMs as well, making them visible in the DM sidebar.
 *
 * Listens for `dm.received` and `group_dm.received` WebSocket events to
 * automatically refetch when new DMs arrive.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRelay, useEvent } from '@relaycast/react';
import { useRelayConfigStatus } from '../../providers/RelayConfigProvider';

export interface AllDmConversation {
  id: string;
  channelId?: string;
  type: string;
  participants: string[];
  lastMessage: {
    text: string;
    agentName: string;
    createdAt: string;
  } | null;
  messageCount: number;
  unreadCount?: number;
}

interface UseAllDMsResult {
  conversations: AllDmConversation[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAllDMs(): UseAllDMsResult {
  const { configured } = useRelayConfigStatus();
  const [conversations, setConversations] = useState<AllDmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchingRef = useRef(false);

  // useRelay() throws if not inside RelayProvider, but we always are.
  // When relay is not configured, the provider uses dummy credentials and
  // allDmConversations will fail — we guard with `configured`.
  let relay: ReturnType<typeof useRelay> | null = null;
  try {
    relay = useRelay();
  } catch {
    // Not inside RelayProvider — relay stays null
  }

  const fetchConversations = useCallback(async () => {
    if (!configured || !relay || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await relay.allDmConversations();
      setConversations(Array.isArray(data) ? data as AllDmConversation[] : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [configured, relay]);

  // Initial fetch
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    void fetchConversations();
  }, [configured, fetchConversations]);

  // Refetch when DM events arrive via WebSocket
  useEvent('dm.received', () => {
    void fetchConversations();
  });
  useEvent('group_dm.received', () => {
    void fetchConversations();
  });

  return { conversations, loading, error, refetch: fetchConversations };
}
