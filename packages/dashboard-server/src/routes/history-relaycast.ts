/**
 * History routes backed by the Relaycast SDK (for proxy/standalone mode).
 * Replaces the legacy StorageAdapter-based history.ts when no local DB is available.
 */

import type { Express, Request, Response } from 'express';
import {
  fetchAgents,
  fetchAllMessages,
  fetchChannels,
  fetchChannelMessages,
} from '../relaycast-provider.js';
import type { RouteContext } from '../lib/types.js';

export function registerRelaycastHistoryRoutes(app: Express, ctx: RouteContext): void {
  // GET /api/history/stats
  app.get('/api/history/stats', async (_req: Request, res: Response) => {
    try {
      const config = ctx.resolveRelaycastConfig();
      let messageCount = 0;
      let uniqueAgentCount = 0;
      let oldestMessageDate: string | null = null;

      if (config) {
        try {
          const [agents, messages] = await Promise.all([
            fetchAgents(config),
            fetchAllMessages(config),
          ]);
          messageCount = messages.length;
          uniqueAgentCount = new Set(agents.map((a) => a.name)).size;

          if (messages.length > 0) {
            const oldestTs = messages.reduce((oldest: number, m) => {
              const ts = new Date(m.timestamp).getTime();
              return ts && !isNaN(ts) && ts < oldest ? ts : oldest;
            }, Infinity);
            if (oldestTs < Infinity) {
              oldestMessageDate = new Date(oldestTs).toISOString();
            }
          }
        } catch {
          // Relaycast data unavailable — return defaults
        }
      }

      res.json({
        messageCount,
        sessionCount: 0,
        activeSessions: 0,
        uniqueAgents: uniqueAgentCount,
        oldestMessageDate,
      });
    } catch (err) {
      console.error('[dashboard] Failed to fetch history stats:', err);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // GET /api/history/messages
  app.get('/api/history/messages', async (req: Request, res: Response) => {
    try {
      const config = ctx.resolveRelaycastConfig();
      if (!config) {
        res.json({ messages: [] });
        return;
      }

      const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
      const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
      const fromFilter = req.query.from as string | undefined;
      const toFilter = req.query.to as string | undefined;
      const searchTerm = req.query.search as string | undefined;

      let messages = await fetchAllMessages(config);

      // Apply filters
      if (fromFilter) {
        const lf = fromFilter.toLowerCase();
        messages = messages.filter((m) => m.from.toLowerCase().includes(lf));
      }
      if (toFilter) {
        const lt = toFilter.toLowerCase();
        messages = messages.filter((m) => m.to.toLowerCase().includes(lt));
      }
      if (searchTerm?.trim()) {
        const ls = searchTerm.toLowerCase();
        messages = messages.filter(
          (m) =>
            m.content.toLowerCase().includes(ls) ||
            m.from.toLowerCase().includes(ls) ||
            m.to.toLowerCase().includes(ls),
        );
      }

      // Sort
      messages.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return order === 'asc' ? ta - tb : tb - ta;
      });

      // Limit
      const sliced = messages.slice(0, limit);

      res.json({
        messages: sliced.map((m) => ({
          id: m.id,
          from: m.from,
          to: m.to,
          content: m.content,
          timestamp: m.timestamp,
          thread: m.thread,
          isBroadcast: m.to === '*',
          status: m.status,
        })),
      });
    } catch (err) {
      console.error('[dashboard] Failed to fetch history messages:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // GET /api/history/conversations
  app.get('/api/history/conversations', async (_req: Request, res: Response) => {
    try {
      const config = ctx.resolveRelaycastConfig();
      if (!config) {
        res.json({ conversations: [] });
        return;
      }

      const [channels, allMessages] = await Promise.all([
        fetchChannels(config),
        fetchAllMessages(config),
      ]);

      const conversationMap = new Map<
        string,
        { participants: string[]; lastMessage: string; lastTimestamp: string; messageCount: number }
      >();

      // Build conversations from channel messages
      for (const channel of channels) {
        const key = `#${channel.name}`;
        const channelMsgs = allMessages.filter((m) => m.to === key || m.to === channel.name);
        if (channelMsgs.length > 0) {
          const participants = [...new Set(channelMsgs.map((m) => m.from))];
          const last = channelMsgs.reduce((a, b) =>
            new Date(a.timestamp).getTime() > new Date(b.timestamp).getTime() ? a : b,
          );
          conversationMap.set(key, {
            participants,
            lastMessage: last.content.slice(0, 100),
            lastTimestamp: last.timestamp,
            messageCount: channelMsgs.length,
          });
        }
      }

      // Build conversations from DMs (non-channel, non-broadcast)
      for (const msg of allMessages) {
        if (msg.to === '*' || msg.to.startsWith('#')) continue;

        const participants = [msg.from, msg.to].sort();
        const key = participants.join(':');

        const existing = conversationMap.get(key);
        if (existing) {
          existing.messageCount++;
          if (new Date(msg.timestamp).getTime() > new Date(existing.lastTimestamp).getTime()) {
            existing.lastMessage = msg.content.slice(0, 100);
            existing.lastTimestamp = msg.timestamp;
          }
        } else {
          conversationMap.set(key, {
            participants,
            lastMessage: msg.content.slice(0, 100),
            lastTimestamp: msg.timestamp,
            messageCount: 1,
          });
        }
      }

      const conversations = Array.from(conversationMap.values()).sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime(),
      );

      res.json({ conversations });
    } catch (err) {
      console.error('[dashboard] Failed to fetch conversations:', err);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });
}
