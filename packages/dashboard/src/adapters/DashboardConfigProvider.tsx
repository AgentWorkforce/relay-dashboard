import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

import type {
  CloudApiAdapter,
  CloudAuthAdapter,
  CloudSettingsSlots,
  DashboardFeatures,
} from './types';

export interface DashboardConfig {
  features: DashboardFeatures;
  api?: CloudApiAdapter;
  auth?: CloudAuthAdapter;
  settingsSlots?: CloudSettingsSlots;
  isCloudMode: boolean;
}

export const defaultDashboardFeatures: DashboardFeatures = {
  billing: false,
  teams: false,
  workspaces: false,
  auth: false,
};

export const defaultDashboardConfig: DashboardConfig = {
  features: defaultDashboardFeatures,
  api: undefined,
  auth: undefined,
  settingsSlots: undefined,
  isCloudMode: false,
};

const DashboardConfigContext = createContext<DashboardConfig>(defaultDashboardConfig);

export interface DashboardConfigProviderProps {
  config?: Partial<DashboardConfig>;
  children: ReactNode;
}

export function DashboardConfigProvider({ config, children }: DashboardConfigProviderProps) {
  const value: DashboardConfig = {
    ...defaultDashboardConfig,
    ...config,
    features: {
      ...defaultDashboardFeatures,
      ...(config?.features ?? {}),
    },
    settingsSlots: config?.settingsSlots ?? defaultDashboardConfig.settingsSlots,
  };

  return <DashboardConfigContext.Provider value={value}>{children}</DashboardConfigContext.Provider>;
}

export function useDashboardConfig(): DashboardConfig {
  return useContext(DashboardConfigContext);
}
