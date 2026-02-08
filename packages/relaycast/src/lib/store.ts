import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ------------------------------------------------------------------ */
/*  Auth Store                                                         */
/* ------------------------------------------------------------------ */

export interface Workspace {
  name: string;
  plan?: string;
}

interface AuthState {
  apiKey: string | null;
  agentToken: string | null;
  workspace: Workspace | null;
  setAuth: (apiKey: string, agentToken: string, workspace: Workspace) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      apiKey: null,
      agentToken: null,
      workspace: null,
      setAuth: (apiKey, agentToken, workspace) =>
        set({ apiKey, agentToken, workspace }),
      logout: () => set({ apiKey: null, agentToken: null, workspace: null }),
    }),
    { name: 'relaycast_auth' },
  ),
);

/* ------------------------------------------------------------------ */
/*  Channel Store                                                      */
/* ------------------------------------------------------------------ */

export interface Channel {
  name: string;
  topic?: string;
  member_count?: number;
  unread?: number;
}

interface ChannelState {
  channels: Channel[];
  activeChannel: string | null;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (name: string | null) => void;
  addChannel: (channel: Channel) => void;
  removeChannel: (name: string) => void;
}

export const useChannelStore = create<ChannelState>()((set) => ({
  channels: [],
  activeChannel: null,
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (name) => set({ activeChannel: name }),
  addChannel: (channel) =>
    set((s) => ({ channels: [...s.channels, channel] })),
  removeChannel: (name) =>
    set((s) => ({ channels: s.channels.filter((c) => c.name !== name) })),
}));

/* ------------------------------------------------------------------ */
/*  Message Store                                                      */
/* ------------------------------------------------------------------ */

export interface Message {
  id: string;
  channel_name?: string;
  agent_name: string;
  text: string;
  created_at: string;
  reply_count?: number;
  reactions?: { emoji: string; count: number; agents: string[] }[];
}

interface MessageState {
  messagesByChannel: Record<string, Message[]>;
  setMessages: (channel: string, messages: Message[]) => void;
  appendMessage: (channel: string, message: Message) => void;
  prependMessages: (channel: string, messages: Message[]) => void;
  clearMessages: (channel: string) => void;
}

export const useMessageStore = create<MessageState>()((set) => ({
  messagesByChannel: {},
  setMessages: (channel, messages) =>
    set((s) => ({
      messagesByChannel: { ...s.messagesByChannel, [channel]: messages },
    })),
  appendMessage: (channel, message) =>
    set((s) => {
      const existing = s.messagesByChannel[channel] ?? [];
      // Deduplicate: skip if this message ID already exists
      if (existing.some((m) => m.id === message.id)) return s;
      // Replace optimistic temp message if one exists for this channel
      const hasTemp = existing.some((m) => m.id.startsWith('temp-'));
      const updated = hasTemp
        ? [...existing.filter((m) => !m.id.startsWith('temp-')), message]
        : [...existing, message];
      return {
        messagesByChannel: { ...s.messagesByChannel, [channel]: updated },
      };
    }),
  prependMessages: (channel, messages) =>
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [channel]: [...messages, ...(s.messagesByChannel[channel] ?? [])],
      },
    })),
  clearMessages: (channel) =>
    set((s) => {
      const copy = { ...s.messagesByChannel };
      delete copy[channel];
      return { messagesByChannel: copy };
    }),
}));

/* ------------------------------------------------------------------ */
/*  Thread Store                                                       */
/* ------------------------------------------------------------------ */

interface ThreadState {
  parentMessage: Message | null;
  replies: Message[];
  openThread: (msg: Message) => void;
  closeThread: () => void;
  setReplies: (replies: Message[]) => void;
  appendReply: (reply: Message) => void;
}

export const useThreadStore = create<ThreadState>()((set) => ({
  parentMessage: null,
  replies: [],
  openThread: (msg) => set({ parentMessage: msg, replies: [] }),
  closeThread: () => set({ parentMessage: null, replies: [] }),
  setReplies: (replies) => set({ replies }),
  appendReply: (reply) =>
    set((s) => {
      if (s.replies.some((r) => r.id === reply.id)) return s;
      const hasTemp = s.replies.some((r) => r.id.startsWith('temp-'));
      const updated = hasTemp
        ? [...s.replies.filter((r) => !r.id.startsWith('temp-')), reply]
        : [...s.replies, reply];
      return { replies: updated };
    }),
}));
