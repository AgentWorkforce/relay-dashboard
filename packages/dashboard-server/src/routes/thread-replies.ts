/**
 * Thread reply routes for proxy/standalone modes.
 */

import path from 'path';
import type { Express, Request, Response } from 'express';
import { fetchAllMessages } from '../relaycast-provider.js';
import type { Message, RelaycastConfig } from '../relaycast-provider-types.js';
import { resolveIdentity } from '../lib/identity.js';
import type { RouteContext } from '../lib/types.js';

function parseBeforeCursor(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  const asNumber = Number.parseInt(raw, 10);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  const asTime = Date.parse(raw);
  return Number.isNaN(asTime) ? undefined : asTime;
}

function parseTimestamp(raw: string): number {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findParentMessage(messages: Message[], id: string): Message | null {
  const exact = messages.find((message) => message.id === id);
  if (exact) {
    return exact;
  }

  return messages.find((message) => message.id.startsWith(id) || id.startsWith(message.id)) ?? null;
}

function mapMessage(message: Message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    content: message.content,
    timestamp: message.timestamp,
    thread: message.thread,
    replyCount: message.replyCount,
  };
}

function resolveReplyTarget(parent: Message, senderName: string): string {
  if (parent.to.startsWith('#')) {
    return parent.to;
  }
  if (parent.to === '*') {
    return parent.from;
  }
  return parent.from === senderName ? parent.to : parent.from;
}

function resolveSenderName(
  rawSender: unknown,
  config: RelaycastConfig | null,
  projectName: string,
): string {
  const senderInput = typeof rawSender === 'string' ? rawSender.trim() : '';
  const fallback = config?.projectIdentity?.trim() || projectName;
  return resolveIdentity(senderInput || fallback, { projectIdentity: fallback });
}

export function registerThreadReplyRoutes(app: Express, ctx: RouteContext): void {
  const projectName = path.basename(path.resolve(ctx.dataDir, '..')) || 'Dashboard';

  app.get('/api/messages/:id/replies', async (req: Request, res: Response) => {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      res.status(400).json({ ok: false, error: 'Message id is required' });
      return;
    }
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const beforeTs = parseBeforeCursor(req.query.before);

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        ok: false,
        error: "Relaycast credentials not configured. Set RELAY_API_KEY or create .agent-relay/relaycast.json",
      });
      return;
    }

    try {
      const allMessages = await fetchAllMessages(config);
      const parent = findParentMessage(allMessages, id);
      if (!parent) {
        res.status(404).json({ ok: false, error: 'Message not found' });
        return;
      }

      const allReplies = allMessages
        .filter((message) => message.thread === parent.id || message.thread === id)
        .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
      const filteredReplies = beforeTs
        ? allReplies.filter((message) => parseTimestamp(message.timestamp) < beforeTs)
        : allReplies;
      const replies = filteredReplies.length > limit ? filteredReplies.slice(-limit) : filteredReplies;
      const hasMore = filteredReplies.length > replies.length;
      const nextCursor = hasMore && replies.length > 0 ? replies[0]?.timestamp : undefined;

      res.json({
        ok: true,
        data: {
          parent: {
            ...mapMessage(parent),
            reply_count: allReplies.length,
          },
          replies: replies.map(mapMessage),
          nextCursor,
        },
      });
    } catch (err) {
      console.error(`[dashboard] Failed to load thread replies for ${id}:`, err);
      res.status(500).json({ ok: false, error: 'Failed to load thread replies' });
    }
  });

  app.post('/api/messages/:id/replies', async (req: Request, res: Response) => {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      res.status(400).json({ ok: false, error: 'Message id is required' });
      return;
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ ok: false, error: 'Missing "text" field' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        ok: false,
        error: "Relaycast credentials not configured. Set RELAY_API_KEY or create .agent-relay/relaycast.json",
      });
      return;
    }

    // `to` may be provided by the client as a fallback when the parent message
    // isn't available in the current Relaycast workspace (e.g. message from a
    // previous session that only lives in the broker WebSocket stream).
    const fallbackTo = typeof req.body?.to === 'string' ? req.body.to.trim() : '';

    try {
      const allMessages = await fetchAllMessages(config);
      const parent = findParentMessage(allMessages, id);

      if (!parent && !fallbackTo) {
        res.status(404).json({ ok: false, error: 'Message not found' });
        return;
      }

      const senderName = resolveSenderName(req.body?.from, config, projectName);

      let target: string;
      let threadId: string;
      if (parent) {
        target = resolveReplyTarget(parent, senderName);
        threadId = parent.id;
      } else {
        // Parent not in Relaycast (e.g. from previous session); use client-provided target.
        target = fallbackTo;
        threadId = id;
      }

      const sendResult = await ctx.sendRelaycastMessage({
        to: target,
        message: text,
        from: senderName,
        thread: threadId,
      });

      if (!sendResult.success) {
        res.status(sendResult.status).json({ ok: false, error: sendResult.error });
        return;
      }

      res.status(201).json({
        ok: true,
        data: {
          id: sendResult.messageId,
          from: senderName,
          to: target,
          content: text,
          timestamp: new Date().toISOString(),
          thread: threadId,
        },
      });
    } catch (err) {
      console.error(`[dashboard] Failed to post thread reply for ${id}:`, err);
      res.status(500).json({ ok: false, error: 'Failed to post reply' });
    }
  });
}
