/**
 * Settings Types
 *
 * Dashboard settings types for appearance, notifications, display, and connection preferences.
 */

/** CLI type identifiers matching agent templates */
export type CliType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'droid' | 'cursor' | 'custom';

/** Agent spawning default preferences */
export interface AgentDefaults {
  /** Default CLI type when opening spawn modal (null = show all templates) */
  defaultCliType: CliType | null;
  /** Default models for each CLI type that supports model selection */
  defaultModels: {
    claude: string;
    cursor: string;
    codex: string;
    gemini: string;
  };
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  notifications: {
    enabled: boolean;
    sound: boolean;
    desktop: boolean;
    mentionsOnly: boolean;
  };
  display: {
    compactMode: boolean;
    showTimestamps: boolean;
    showAvatars: boolean;
    animationsEnabled: boolean;
  };
  messages: {
    autoScroll: boolean;
  };
  connection: {
    autoReconnect: boolean;
    reconnectDelay: number;
    keepAliveInterval: number;
  };
  agentDefaults: AgentDefaults;
}

export const defaultSettings: Settings = {
  theme: 'system',
  notifications: {
    enabled: true,
    sound: true,
    desktop: false,
    mentionsOnly: false,
  },
  display: {
    compactMode: false,
    showTimestamps: true,
    showAvatars: true,
    animationsEnabled: true,
  },
  messages: {
    autoScroll: true,
  },
  connection: {
    autoReconnect: true,
    reconnectDelay: 3000,
    keepAliveInterval: 30000,
  },
  agentDefaults: {
    defaultCliType: null,
    defaultModels: {
      claude: 'sonnet',
      cursor: 'opus-4.5-thinking',
      codex: 'gpt-5.2-codex',
      gemini: 'gemini-2.5-pro',
    },
  },
};
