import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Application } from 'express';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  filePath?: string;
  width?: number;
  height?: number;
  data?: string;
}

interface RelayClientLike {
  state: string;
  sendMessage: (
    to: string,
    body: string,
    kind?: string,
    data?: unknown,
    thread?: string
  ) => boolean;
}

interface SendRequestBody {
  to?: string;
  message?: string;
  thread?: string;
  attachments?: string[];
  from?: string;
}

interface BridgeSendRequestBody {
  projectId?: string;
  to?: string;
  message?: string;
}

interface UploadRequestBody {
  filename?: string;
  mimeType?: string;
  data?: string;
}

export interface MessagingRouteDeps {
  getTeamMembers: (teamName: string) => string[];
  isAgentOnline: (agentName: string) => boolean;
  isRecipientOnline: (recipient: string) => boolean;
  getRelayClient: (
    senderName?: string,
    entityType?: 'agent' | 'user'
  ) => Promise<RelayClientLike>;
  attachmentRegistry: Map<string, Attachment>;
  attachmentsDir: string;
  broadcastData: () => Promise<void>;
}

/**
 * Integrated messaging and attachment routes.
 */
export function registerMessagingRoutes(app: Application, deps: MessagingRouteDeps): void {
  const {
    getTeamMembers,
    isAgentOnline,
    isRecipientOnline,
    getRelayClient,
    attachmentRegistry,
    attachmentsDir,
    broadcastData,
  } = deps;

  // API endpoint to send messages.
  app.post('/api/send', async (req, res) => {
    const { to, message, thread, attachments: attachmentIds, from: senderName } = req.body as SendRequestBody;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing "to" or "message" field' });
    }

    // Check if this is a team mention (team:teamName).
    const teamMatch = to.match(/^team:(.+)$/);
    let targets: string[];

    if (teamMatch) {
      const teamName = teamMatch[1];
      const members = getTeamMembers(teamName);
      if (members.length === 0) {
        return res.status(404).json({ error: `No agents found in team "${teamName}"` });
      }
      // Filter to only online members.
      targets = members.filter(isAgentOnline);
      if (targets.length === 0) {
        return res.status(404).json({ error: `No online agents in team "${teamName}"` });
      }
    } else {
      // Fail fast if target agent is offline (except broadcasts).
      if (to !== '*' && !isRecipientOnline(to)) {
        return res.status(404).json({ error: `Recipient "${to}" is not online` });
      }
      targets = [to];
    }

    // Always use 'Dashboard' client to avoid name conflicts with user agents.
    const relayClient = await getRelayClient('Dashboard');
    if (!relayClient || relayClient.state !== 'READY') {
      return res.status(503).json({ error: 'Relay adapter is not ready' });
    }

    try {
      // Resolve attachments if provided.
      let attachments: Attachment[] | undefined;
      if (attachmentIds && Array.isArray(attachmentIds) && attachmentIds.length > 0) {
        attachments = [];
        for (const id of attachmentIds) {
          const attachment = attachmentRegistry.get(id);
          if (attachment) {
            attachments.push(attachment);
          }
        }
      }

      // Include attachments, channel context, and sender info in the message data field.
      const isBroadcast = targets.length === 1 && targets[0] === '*';
      const messageData: Record<string, unknown> = {};

      if (attachments && attachments.length > 0) {
        messageData.attachments = attachments;
      }

      if (isBroadcast) {
        messageData.channel = 'general';
      }

      // Include actual sender name for dashboard messages for UI attribution.
      if (senderName) {
        messageData.senderName = senderName;
      }

      const hasMessageData = Object.keys(messageData).length > 0;

      // Send to all targets (single agent, team members, or broadcast).
      let allSent = true;
      for (const target of targets) {
        const sent = relayClient.sendMessage(target, message, 'message', hasMessageData ? messageData : undefined, thread);
        if (!sent) {
          allSent = false;
          console.error(`[dashboard] Failed to send message to ${target}`);
        }
      }

      if (allSent) {
        // Broadcast updated data to all connected clients so they see the sent message.
        broadcastData().catch((err) => console.error('[dashboard] Failed to broadcast after send:', err));
        return res.json({ success: true, sentTo: targets.length > 1 ? targets : targets[0] });
      }

      return res.status(500).json({ error: 'Failed to send message to some recipients' });
    } catch (err) {
      console.error('[dashboard] Failed to send message:', err);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // API endpoint to send messages via bridge (cross-project).
  app.post('/api/bridge/send', async (req, res) => {
    const { projectId, to, message } = req.body as BridgeSendRequestBody;

    if (!projectId || !to || !message) {
      return res.status(400).json({ error: 'Missing "projectId", "to", or "message" field' });
    }

    return res.status(501).json({
      error: 'Legacy socket bridge sending has been removed. Use broker/relaycast messaging paths instead.',
    });
  });

  // API endpoint to upload attachments (images/screenshots).
  app.post('/api/upload', async (req, res) => {
    const { filename, mimeType, data } = req.body as UploadRequestBody;

    // Validate required fields.
    if (!filename || !mimeType || !data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: filename, mimeType, data',
      });
    }

    // Validate mime type (only allow images for now).
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
      });
    }

    try {
      // Decode base64 data.
      const base64Data = data.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Generate unique ID and filename for the attachment.
      const attachmentId = crypto.randomUUID();
      const timestamp = Date.now();
      const ext = mimeType.split('/')[1].replace('svg+xml', 'svg');
      const safeFilename = `${attachmentId.substring(0, 8)}-${timestamp}.${ext}`;

      // Save to ~/.relay/attachments/ directory for agents to access.
      const attachmentFilePath = path.join(attachmentsDir, safeFilename);
      fs.writeFileSync(attachmentFilePath, buffer);

      // Create attachment record with file path for agents.
      const attachment: Attachment = {
        id: attachmentId,
        filename,
        mimeType,
        size: buffer.length,
        url: `/attachments/${safeFilename}`,
        filePath: attachmentFilePath,
        data,
      };

      // Store in registry for lookup when sending messages.
      attachmentRegistry.set(attachmentId, attachment);

      console.log(`[dashboard] Uploaded attachment: ${filename} (${buffer.length} bytes) -> ${attachmentFilePath}`);

      return res.json({
        success: true,
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: attachment.url,
          filePath: attachment.filePath,
        },
      });
    } catch (err) {
      console.error('[dashboard] Upload failed:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to upload file',
      });
    }
  });

  // API endpoint to get attachment by ID.
  app.get('/api/attachment/:id', (req, res) => {
    const { id } = req.params;
    const attachment = attachmentRegistry.get(id);

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    return res.json({
      success: true,
      attachment: {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: attachment.url,
        filePath: attachment.filePath,
      },
    });
  });
}
