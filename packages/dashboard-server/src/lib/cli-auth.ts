import crypto from 'crypto';
import { getSupportedProviders as getConfiguredProviders } from '@agent-relay/config/cli-auth-config';

export interface StartCLIAuthOptions {
  useDeviceFlow?: boolean;
  userId?: string;
}

export interface AuthSession {
  id: string;
  provider: string;
  userId?: string;
  status: 'starting' | 'waiting_auth' | 'success' | 'error';
  authUrl?: string;
  token?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SubmitAuthCodeResult {
  success: boolean;
  error?: string;
  needsRestart?: boolean;
}

interface CompleteAuthResult {
  success: boolean;
  error?: string;
  token?: string;
}

interface SupportedProvider {
  id: string;
  displayName: string;
  command: string;
}

interface DaemonCLIAuthApi {
  startCLIAuth(provider: string, options?: StartCLIAuthOptions): Promise<AuthSession>;
  getAuthSession(sessionId: string): AuthSession | null;
  cancelAuthSession(sessionId: string): boolean;
  submitAuthCode(sessionId: string, code: string): Promise<SubmitAuthCodeResult>;
  completeAuthSession(sessionId: string): Promise<CompleteAuthResult>;
  getSupportedProviders(): SupportedProvider[];
}

const sessions = new Map<string, AuthSession>();
let daemonApi: DaemonCLIAuthApi | null = null;
let daemonApiLoadPromise: Promise<void> | undefined;
const daemonModuleId = '@agent-relay/daemon';

function getFallbackProviders(): SupportedProvider[] {
  try {
    const providers = getConfiguredProviders();
    if (Array.isArray(providers) && providers.length > 0) {
      return providers as SupportedProvider[];
    }
  } catch {
    // Ignore and use static fallback below.
  }

  return [
    { id: 'claude', displayName: 'Claude', command: 'claude' },
    { id: 'openai', displayName: 'OpenAI / Codex', command: 'codex' },
    { id: 'gemini', displayName: 'Gemini', command: 'gemini' },
  ];
}

async function loadDaemonApi(): Promise<DaemonCLIAuthApi | null> {
  if (daemonApi) {
    return daemonApi;
  }

  if (!daemonApiLoadPromise) {
    daemonApiLoadPromise = import(daemonModuleId)
      .then((mod) => {
        if (
          typeof mod.startCLIAuth === 'function' &&
          typeof mod.getAuthSession === 'function' &&
          typeof mod.cancelAuthSession === 'function' &&
          typeof mod.submitAuthCode === 'function' &&
          typeof mod.completeAuthSession === 'function' &&
          typeof mod.getSupportedProviders === 'function'
        ) {
          daemonApi = {
            startCLIAuth: mod.startCLIAuth as DaemonCLIAuthApi['startCLIAuth'],
            getAuthSession: mod.getAuthSession as DaemonCLIAuthApi['getAuthSession'],
            cancelAuthSession: mod.cancelAuthSession as DaemonCLIAuthApi['cancelAuthSession'],
            submitAuthCode: mod.submitAuthCode as DaemonCLIAuthApi['submitAuthCode'],
            completeAuthSession: mod.completeAuthSession as DaemonCLIAuthApi['completeAuthSession'],
            getSupportedProviders: mod.getSupportedProviders as DaemonCLIAuthApi['getSupportedProviders'],
          };
        }
      })
      .catch(() => {
        // Daemon package isn't present in this workspace; use fallback implementation.
      })
      .then(() => undefined);
  }

  await daemonApiLoadPromise;
  return daemonApi;
}

function touchSession(session: AuthSession): void {
  session.updatedAt = new Date();
  sessions.set(session.id, session);
}

export async function startCLIAuth(provider: string, options?: StartCLIAuthOptions): Promise<AuthSession> {
  const api = await loadDaemonApi();
  if (api) {
    return api.startCLIAuth(provider, options);
  }

  const supportedProviders = getFallbackProviders();
  if (!supportedProviders.some((p) => p.id === provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const now = new Date();
  const session: AuthSession = {
    id: crypto.randomUUID(),
    provider,
    userId: options?.userId,
    status: 'waiting_auth',
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(session.id, session);
  return session;
}

export function getAuthSession(sessionId: string): AuthSession | null {
  if (daemonApi) {
    return daemonApi.getAuthSession(sessionId);
  }
  return sessions.get(sessionId) ?? null;
}

export function cancelAuthSession(sessionId: string): boolean {
  if (daemonApi) {
    return daemonApi.cancelAuthSession(sessionId);
  }
  return sessions.delete(sessionId);
}

export async function submitAuthCode(sessionId: string, code: string): Promise<SubmitAuthCodeResult> {
  const api = await loadDaemonApi();
  if (api) {
    return api.submitAuthCode(sessionId, code);
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return {
      success: false,
      error: 'Session not found',
      needsRestart: true,
    };
  }

  if (!code.trim()) {
    session.status = 'error';
    session.error = 'Auth code is required';
    touchSession(session);
    return {
      success: false,
      error: session.error,
      needsRestart: false,
    };
  }

  session.status = 'success';
  session.token = code.trim();
  session.tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  session.error = undefined;
  touchSession(session);

  return { success: true };
}

export async function completeAuthSession(sessionId: string): Promise<CompleteAuthResult> {
  const api = await loadDaemonApi();
  if (api) {
    return api.completeAuthSession(sessionId);
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status === 'success') {
    return { success: true, token: session.token };
  }

  if (session.status === 'error') {
    return { success: false, error: session.error ?? 'Authentication failed' };
  }

  return { success: false, error: 'Authentication still in progress' };
}

export function getSupportedProviders(): SupportedProvider[] {
  if (daemonApi) {
    return daemonApi.getSupportedProviders();
  }
  return getFallbackProviders();
}
