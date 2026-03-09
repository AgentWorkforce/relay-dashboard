import {
  mapMessageWithMetaToChannelMessage,
  formatReplyCountLabel,
} from '@relaycast/react';
import type { ChannelMessage as ChannelApiMessage } from '../components/channels';
import type { Message } from '../types';
import { normalizeDashboardName } from './identity';

type RelaycastMessageWithMeta = Parameters<typeof mapMessageWithMetaToChannelMessage>[1];
type RelayDmConversationLike = {
  id: string;
  participants: unknown[];
};

export function getRelayDmParticipantName(participant: unknown): string | null {
  if (typeof participant === 'string') {
    return normalizeRelayIdentity(participant);
  }

  if (participant === null || typeof participant !== 'object') {
    return null;
  }

  const record = participant as Record<string, unknown>;
  const rawName = (
    record.agent_name
    ?? record.agentName
    ?? record.name
    ?? record.username
  );

  if (typeof rawName !== 'string') {
    return null;
  }

  return normalizeRelayIdentity(rawName);
}

function normalizeRelayIdentity(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeDashboardName(trimmed);
}

export function mapRelayMessageToChannelApiMessage(
  channelId: string,
  message: RelaycastMessageWithMeta,
  currentUserName?: string,
): ChannelApiMessage {
  return mapMessageWithMetaToChannelMessage(channelId, message, {
    currentUserName,
  }) as ChannelApiMessage;
}

export function formatRelayReplyCountLabel(replyCount: number): string {
  return formatReplyCountLabel(replyCount);
}

function resolveDmRecipient(
  participants: unknown[],
  sender: string,
): string | null {
  const senderKey = normalizeRelayIdentity(sender).toLowerCase();

  for (const participant of participants) {
    const normalized = getRelayDmParticipantName(participant);
    if (!normalized) continue;
    if (normalized.toLowerCase() !== senderKey) {
      return normalized;
    }
  }

  for (const participant of participants) {
    const normalized = getRelayDmParticipantName(participant);
    if (!normalized) continue;
    return normalized;
  }

  return null;
}

export function normalizeRelayDmMessageTargets(
  messages: Message[],
  conversations: RelayDmConversationLike[],
): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const participantsByConversationId = new Map<string, unknown[]>();
  for (const conversation of conversations) {
    participantsByConversationId.set(conversation.id, conversation.participants ?? []);
  }

  let changed = false;
  const normalized = messages.map((message) => {
    const target = message.to?.trim();
    if (!target) {
      return message;
    }

    let normalizedTarget = normalizeRelayIdentity(target);

    if (target.startsWith('dm_')) {
      const participants = participantsByConversationId.get(target);
      if (participants) {
        const resolvedRecipient = resolveDmRecipient(participants, message.from);
        if (resolvedRecipient && resolvedRecipient !== target) {
          normalizedTarget = resolvedRecipient;
        }
      }
    }

    if (!normalizedTarget || normalizedTarget === target) {
      return message;
    }

    changed = true;
    return {
      ...message,
      to: normalizedTarget,
    };
  });

  return changed ? normalized : messages;
}
