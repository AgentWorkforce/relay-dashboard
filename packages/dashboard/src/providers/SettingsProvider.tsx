/**
 * Settings Provider
 *
 * Manages user preferences: theme, display options, notification settings.
 * Persists to localStorage and applies theme to the document root.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultSettings, type Settings } from '../components/settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LegacyDashboardSettings = {
  theme?: 'dark' | 'light' | 'system';
  compactMode?: boolean;
  showTimestamps?: boolean;
  soundEnabled?: boolean;
  notificationsEnabled?: boolean;
  autoScrollMessages?: boolean;
};

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (updater: (prev: Settings) => Settings) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_STORAGE_KEY = 'dashboard-settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeSettings(base: Settings, partial: Partial<Settings>): Settings {
  return {
    ...base,
    ...partial,
    notifications: { ...base.notifications, ...partial.notifications },
    display: { ...base.display, ...partial.display },
    messages: { ...base.messages, ...partial.messages },
    connection: { ...base.connection, ...partial.connection },
    agentDefaults: {
      ...base.agentDefaults,
      ...partial.agentDefaults,
      defaultModels: {
        ...base.agentDefaults?.defaultModels,
        ...partial.agentDefaults?.defaultModels,
      },
    },
  };
}

function migrateLegacySettings(raw: LegacyDashboardSettings): Settings {
  const theme = raw.theme && ['dark', 'light', 'system'].includes(raw.theme)
    ? raw.theme
    : defaultSettings.theme;
  const sound = raw.soundEnabled ?? defaultSettings.notifications.sound;
  const desktop = raw.notificationsEnabled ?? defaultSettings.notifications.desktop;
  return {
    ...defaultSettings,
    theme,
    display: {
      ...defaultSettings.display,
      compactMode: raw.compactMode ?? defaultSettings.display.compactMode,
      showTimestamps: raw.showTimestamps ?? defaultSettings.display.showTimestamps,
    },
    notifications: {
      ...defaultSettings.notifications,
      sound,
      desktop,
      enabled: sound || desktop || defaultSettings.notifications.mentionsOnly,
    },
    messages: {
      ...defaultSettings.messages,
      autoScroll: raw.autoScrollMessages ?? defaultSettings.messages.autoScroll,
    },
  };
}

function loadSettingsFromStorage(): Settings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return defaultSettings;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return defaultSettings;
    if ('notifications' in parsed && 'display' in parsed) {
      const merged = mergeSettings(defaultSettings, parsed as Partial<Settings>);
      merged.notifications.enabled = merged.notifications.sound ||
        merged.notifications.desktop ||
        merged.notifications.mentionsOnly;
      return merged;
    }
    if ('notificationsEnabled' in parsed || 'soundEnabled' in parsed || 'autoScrollMessages' in parsed) {
      return migrateLegacySettings(parsed as LegacyDashboardSettings);
    }
  } catch {
    // Fall back to defaults
  }
  return defaultSettings;
}

function saveSettingsToStorage(settings: Settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore localStorage failures
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface SettingsProviderProps {
  children: React.ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettingsFromStorage());

  const updateSettings = useCallback((updater: (prev: Settings) => Settings) => {
    setSettings((prev) => updater(prev));
  }, []);

  // Persist settings changes
  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  // Apply theme to document
  useEffect(() => {
    const applyTheme = (theme: 'light' | 'dark' | 'system') => {
      let effectiveTheme: 'light' | 'dark';

      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        effectiveTheme = prefersDark ? 'dark' : 'light';
      } else {
        effectiveTheme = theme;
      }

      const root = document.documentElement;
      root.classList.remove('theme-light', 'theme-dark');
      root.classList.add(`theme-${effectiveTheme}`);
      root.style.colorScheme = effectiveTheme;
    };

    applyTheme(settings.theme);

    if (settings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [settings.theme]);

  // Request browser notification permissions when enabled
  useEffect(() => {
    if (!settings.notifications.desktop) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') return;

    if (Notification.permission === 'denied') {
      updateSettings((prev) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          desktop: false,
          enabled: prev.notifications.sound || prev.notifications.mentionsOnly,
        },
      }));
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') {
        updateSettings((prev) => ({
          ...prev,
          notifications: {
            ...prev.notifications,
            desktop: false,
            enabled: prev.notifications.sound || prev.notifications.mentionsOnly,
          },
        }));
      }
    }).catch(() => undefined);
  }, [settings.notifications.desktop, settings.notifications.sound, settings.notifications.mentionsOnly, updateSettings]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}

// Re-export the notification sound helper so App can still use it
export function playNotificationSound() {
  if (typeof window === 'undefined') return;
  const AudioContextConstructor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.03;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => {
      context.close().catch(() => undefined);
    };
  } catch {
    // Audio might be blocked by browser autoplay policies
  }
}
