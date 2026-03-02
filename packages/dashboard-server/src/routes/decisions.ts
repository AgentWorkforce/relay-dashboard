import type { Application } from 'express';

export interface Decision {
  id: string;
  agentName: string;
  title: string;
  description: string;
  options?: { id: string; label: string; description?: string }[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  category: 'approval' | 'choice' | 'input' | 'confirmation';
  createdAt: string;
  expiresAt?: string;
  context?: Record<string, unknown>;
}

interface RelayClientLike {
  sendMessage: (
    to: string,
    body: string,
    kind?: string,
    data?: unknown,
    thread?: string
  ) => boolean;
}

export interface DecisionsRouteDeps {
  decisions: Map<string, Decision>;
  getRelayClient: (senderName?: string, entityType?: 'agent' | 'user') => Promise<RelayClientLike>;
  broadcastData: () => Promise<void>;
}

/**
 * Human decision queue routes.
 */
export function registerDecisionsRoutes(app: Application, deps: DecisionsRouteDeps): void {
  const { decisions, getRelayClient, broadcastData } = deps;

  // GET /api/decisions - List all pending decisions.
  app.get('/api/decisions', (_req, res) => {
    const allDecisions = Array.from(decisions.values())
      .sort((a, b) => {
        const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      });
    return res.json({ success: true, decisions: allDecisions });
  });

  // POST /api/decisions - Create a new decision request.
  app.post('/api/decisions', (req, res) => {
    const { agentName, title, description, options, urgency, category, expiresAt, context } = req.body;

    if (!agentName || !title || !urgency || !category) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: agentName, title, urgency, category',
      });
    }

    const decision: Decision = {
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentName,
      title,
      description: description || '',
      options,
      urgency,
      category,
      createdAt: new Date().toISOString(),
      expiresAt,
      context,
    };

    decisions.set(decision.id, decision);
    broadcastData().catch(() => {});
    return res.json({ success: true, decision });
  });

  // POST /api/decisions/:id/approve - Approve/resolve a decision.
  app.post('/api/decisions/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { optionId, response } = req.body;

    const decision = decisions.get(id);
    if (!decision) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }

    const agentName = decision.agentName;
    let responseMessage = `DECISION APPROVED: ${decision.title}`;
    if (optionId && decision.options) {
      const option = decision.options.find((o) => o.id === optionId);
      if (option) {
        responseMessage += `\nSelected: ${option.label}`;
      }
    }
    if (response) {
      responseMessage += `\nResponse: ${response}`;
    }

    try {
      const client = await getRelayClient('Dashboard');
      if (client) {
        await client.sendMessage(agentName, responseMessage, 'message');
      }
    } catch (err) {
      console.warn('[api] Could not send decision response to agent:', err);
    }

    decisions.delete(id);
    broadcastData().catch(() => {});
    return res.json({ success: true, message: 'Decision approved' });
  });

  // POST /api/decisions/:id/reject - Reject a decision.
  app.post('/api/decisions/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const decision = decisions.get(id);
    if (!decision) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }

    const agentName = decision.agentName;
    let responseMessage = `DECISION REJECTED: ${decision.title}`;
    if (reason) {
      responseMessage += `\nReason: ${reason}`;
    }

    try {
      const client = await getRelayClient('Dashboard');
      if (client) {
        await client.sendMessage(agentName, responseMessage, 'message');
      }
    } catch (err) {
      console.warn('[api] Could not send decision rejection to agent:', err);
    }

    decisions.delete(id);
    broadcastData().catch(() => {});
    return res.json({ success: true, message: 'Decision rejected' });
  });

  // DELETE /api/decisions/:id - Delete/dismiss a decision.
  app.delete('/api/decisions/:id', (_req, res) => {
    const { id } = _req.params;

    if (!decisions.has(id)) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }

    decisions.delete(id);
    broadcastData().catch(() => {});
    return res.json({ success: true, message: 'Decision dismissed' });
  });
}
