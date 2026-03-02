import type { Application } from 'express';
import type { StorageAdapter } from '@agent-relay/storage/adapter';

export interface HistoryRouteDeps {
  storage?: StorageAdapter;
  formatDuration: (startMs: number, endMs?: number) => string;
  isInternalAgent: (name: string) => boolean;
  remapAgentName: (name: string) => string;
}

/**
 * Conversation history and storage statistics routes.
 */
export function registerHistoryRoutes(app: Application, deps: HistoryRouteDeps): void {
  const { storage, formatDuration, isInternalAgent, remapAgentName } = deps;

  // GET /api/history/sessions - List all sessions with filters.
  app.get('/api/history/sessions', async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    try {
      const query: {
        agentName?: string;
        since?: number;
        limit?: number;
      } = {};

      if (req.query.agent && typeof req.query.agent === 'string') {
        query.agentName = req.query.agent;
      }
      if (req.query.since) {
        query.since = parseInt(req.query.since as string, 10);
      }
      query.limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const sessions = storage.getSessions
        ? await storage.getSessions(query)
        : [];

      const result = sessions.map((s) => ({
        id: s.id,
        agentName: s.agentName,
        cli: s.cli,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : undefined,
        duration: formatDuration(s.startedAt, s.endedAt),
        messageCount: s.messageCount,
        summary: s.summary,
        isActive: !s.endedAt,
        closedBy: s.closedBy,
      }));

      return res.json({ sessions: result });
    } catch (err) {
      console.error('Failed to fetch sessions', err);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  // GET /api/history/messages - Get messages with filters.
  app.get('/api/history/messages', async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    try {
      const query: {
        from?: string;
        to?: string;
        thread?: string;
        sinceTs?: number;
        limit?: number;
        order?: 'asc' | 'desc';
      } = {};

      if (req.query.from && typeof req.query.from === 'string') {
        query.from = req.query.from;
      }
      if (req.query.to && typeof req.query.to === 'string') {
        query.to = req.query.to;
      }
      if (req.query.thread && typeof req.query.thread === 'string') {
        query.thread = req.query.thread;
      }
      if (req.query.since) {
        query.sinceTs = parseInt(req.query.since as string, 10);
      }
      query.limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      query.order = (req.query.order as 'asc' | 'desc') || 'desc';

      let messages = await storage.getMessages(query);

      // Filter out messages from/to internal system agents (e.g., __spawner__).
      messages = messages.filter((m) => !isInternalAgent(m.from) && !isInternalAgent(m.to));

      // Client-side search filter (basic substring match).
      const searchTerm = req.query.search as string | undefined;
      if (searchTerm && searchTerm.trim()) {
        const lowerSearch = searchTerm.toLowerCase();
        messages = messages.filter((m) =>
          m.body.toLowerCase().includes(lowerSearch) ||
          m.from.toLowerCase().includes(lowerSearch) ||
          m.to.toLowerCase().includes(lowerSearch),
        );
      }

      const result = messages.map((m) => ({
        id: m.id,
        from: remapAgentName(m.from),
        to: remapAgentName(m.to),
        content: m.body,
        timestamp: new Date(m.ts).toISOString(),
        thread: m.thread,
        isBroadcast: m.is_broadcast,
        isUrgent: m.is_urgent,
        status: m.status,
      }));

      return res.json({ messages: result });
    } catch (err) {
      console.error('Failed to fetch messages', err);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // GET /api/history/conversations - Get unique conversations (agent pairs).
  app.get('/api/history/conversations', async (_req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    try {
      // Get all messages to build conversation list.
      const messages = await storage.getMessages({ limit: 1000, order: 'desc' });

      // Build unique conversation pairs.
      const conversationMap = new Map<string, {
        participants: string[];
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
      }>();

      for (const msg of messages) {
        // Skip broadcasts for conversation pairing.
        if (msg.to === '*' || msg.is_broadcast) continue;

        // Skip messages from/to internal system agents (e.g., __spawner__).
        if (isInternalAgent(msg.from) || isInternalAgent(msg.to)) continue;

        // Create normalized key (sorted participants, with display names).
        const participants = [remapAgentName(msg.from), remapAgentName(msg.to)].sort();
        const key = participants.join(':');

        const existing = conversationMap.get(key);
        if (existing) {
          existing.messageCount++;
        } else {
          conversationMap.set(key, {
            participants,
            lastMessage: msg.body.substring(0, 100),
            lastTimestamp: new Date(msg.ts).toISOString(),
            messageCount: 1,
          });
        }
      }

      // Convert to array sorted by last timestamp.
      const conversations = Array.from(conversationMap.values())
        .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

      return res.json({ conversations });
    } catch (err) {
      console.error('Failed to fetch conversations', err);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });

  // GET /api/history/message/:id - Get a single message by ID.
  app.get('/api/history/message/:id', async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    try {
      const { id } = req.params;
      const message = storage.getMessageById
        ? await storage.getMessageById(id)
        : null;

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      return res.json({
        id: message.id,
        from: message.from,
        to: message.to,
        content: message.body,
        timestamp: new Date(message.ts).toISOString(),
        thread: message.thread,
        isBroadcast: message.is_broadcast,
        isUrgent: message.is_urgent,
        status: message.status,
        data: message.data,
      });
    } catch (err) {
      console.error('Failed to fetch message', err);
      return res.status(500).json({ error: 'Failed to fetch message' });
    }
  });

  // GET /api/history/stats - Get storage statistics.
  app.get('/api/history/stats', async (_req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    try {
      // Get stats from adapter if available (SQLite-specific getStats method).
      const storageWithStats = storage as {
        getStats?: () => Promise<{
          messageCount: number;
          sessionCount: number;
          oldestMessageTs?: number;
        }>;
      };
      if (typeof storageWithStats.getStats === 'function' && typeof storage.getSessions === 'function') {
        const stats = await storageWithStats.getStats();
        const sessions = await storage.getSessions({ limit: 1000 });

        // Calculate additional stats.
        const activeSessions = sessions.filter((s) => !s.endedAt).length;
        const uniqueAgents = new Set(sessions.map((s) => s.agentName)).size;

        return res.json({
          messageCount: stats.messageCount,
          sessionCount: stats.sessionCount,
          activeSessions,
          uniqueAgents,
          oldestMessageDate: stats.oldestMessageTs
            ? new Date(stats.oldestMessageTs).toISOString()
            : null,
        });
      }

      // Basic stats for other adapters.
      const messages = await storage.getMessages({ limit: 1 });
      return res.json({
        messageCount: messages.length > 0 ? 'unknown' : 0,
        sessionCount: 'unknown',
        activeSessions: 'unknown',
        uniqueAgents: 'unknown',
      });
    } catch (err) {
      console.error('Failed to fetch stats', err);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });
}
