import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Application, RequestHandler } from 'express';

type CliAuthSession = {
  id: string;
  status: 'starting' | 'waiting_auth' | 'success' | 'error';
  authUrl?: string;
  error?: string;
  token?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
};

type StartCliAuthResult = {
  id: string;
  status: string;
  authUrl?: string;
};

type SubmitAuthCodeResult = {
  success: boolean;
  error?: string;
  needsRestart?: boolean;
};

type CompleteAuthResult = {
  success: boolean;
  error?: string;
};

type SupportedProvider = {
  id: string;
  displayName?: string;
  command?: string;
};

export interface AuthRouteDeps {
  startCLIAuth: (provider: string, options?: { userId?: string }) => Promise<StartCliAuthResult>;
  getAuthSession: (sessionId: string) => CliAuthSession | null;
  cancelAuthSession: (sessionId: string) => boolean;
  submitAuthCode: (sessionId: string, code: string) => Promise<SubmitAuthCodeResult>;
  completeAuthSession: (sessionId: string) => Promise<CompleteAuthResult>;
  getSupportedProviders: () => SupportedProvider[];
}

/**
 * CLI auth and credential-management routes.
 */
export function registerAuthRoutes(app: Application, deps: AuthRouteDeps): void {
  const {
    startCLIAuth,
    getAuthSession,
    cancelAuthSession,
    submitAuthCode,
    completeAuthSession,
    getSupportedProviders,
  } = deps;

  const validateWorkspaceToken: RequestHandler = (req, res, next) => {
    // Skip auth validation in local mode (no WORKSPACE_TOKEN set).
    const expectedToken = process.env.WORKSPACE_TOKEN;
    if (!expectedToken) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (!token) {
      console.warn('[dashboard] Unauthorized CLI auth request - missing workspace token');
      return res.status(401).json({ error: 'Unauthorized - invalid workspace token' });
    }

    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expectedToken);
    const isValidToken = tokenBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(tokenBuffer, expectedBuffer);

    if (!isValidToken) {
      console.warn('[dashboard] Unauthorized CLI auth request - invalid workspace token');
      return res.status(401).json({ error: 'Unauthorized - invalid workspace token' });
    }

    next();
  };

  // Apply workspace-token validation to all CLI auth endpoints.
  app.use('/auth/cli', validateWorkspaceToken);
  // Apply workspace-token validation to credential mutation endpoints.
  app.use('/api/credentials', validateWorkspaceToken);

  // POST /auth/cli/:provider/start - Start CLI auth flow.
  app.post('/auth/cli/:provider/start', async (req, res) => {
    const { provider } = req.params;
    const { userId } = req.body || {};
    try {
      const session = await startCLIAuth(provider, { userId });
      return res.json({
        sessionId: session.id,
        status: session.status,
        authUrl: session.authUrl,
      });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to start CLI auth',
      });
    }
  });

  // GET /auth/cli/:provider/status/:sessionId - Get auth session status.
  app.get('/auth/cli/:provider/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getAuthSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({
      status: session.status,
      authUrl: session.authUrl,
      error: session.error,
    });
  });

  // GET /auth/cli/:provider/creds/:sessionId - Get credentials from completed auth.
  app.get('/auth/cli/:provider/creds/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getAuthSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status !== 'success') {
      return res.status(400).json({ error: 'Auth not complete', status: session.status });
    }
    return res.json({
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.tokenExpiresAt?.toISOString(),
    });
  });

  // POST /auth/cli/:provider/cancel/:sessionId - Cancel auth session.
  app.post('/auth/cli/:provider/cancel/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const cancelled = cancelAuthSession(sessionId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({ success: true });
  });

  // POST /auth/cli/:provider/code/:sessionId - Submit auth code to PTY.
  app.post('/auth/cli/:provider/code/:sessionId', async (req, res) => {
    const { provider, sessionId } = req.params;
    const { code } = req.body;

    console.log('[cli-auth] Auth code submission received', { provider, sessionId, codeLength: code?.length });

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Auth code is required' });
    }

    try {
      const result = await submitAuthCode(sessionId, code);
      console.log('[cli-auth] Auth code submission result', { provider, sessionId, result });

      if (!result.success) {
        return res.status(400).json({
          error: result.error || 'Session not found or process not running',
          needsRestart: result.needsRestart ?? true,
        });
      }

      // Poll briefly for auth completion after code submission.
      let sessionStatus = 'waiting_auth';
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const session = getAuthSession(sessionId);
        if (session?.status === 'success') {
          sessionStatus = 'success';
          console.log('[cli-auth] Credentials found after code submission', { provider, sessionId, attempt: i + 1 });
          break;
        }
        if (session?.status === 'error') {
          sessionStatus = 'error';
          break;
        }
      }

      return res.json({
        success: true,
        message: 'Auth code submitted',
        status: sessionStatus,
      });
    } catch (err) {
      console.error('[cli-auth] Auth code submission error', { provider, sessionId, error: String(err) });
      return res.status(500).json({
        error: 'Internal error submitting auth code. Please try again.',
        needsRestart: true,
      });
    }
  });

  // POST /auth/cli/:provider/complete/:sessionId - Complete auth.
  app.post('/auth/cli/:provider/complete/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { authCode } = req.body || {};

    if (authCode && typeof authCode === 'string') {
      let code = authCode;
      if (authCode.startsWith('http')) {
        try {
          const url = new URL(authCode);
          const codeParam = url.searchParams.get('code');
          if (codeParam) {
            code = codeParam;
          }
        } catch {
          // Not a valid URL, use as-is.
        }
      }

      const submitResult = await submitAuthCode(sessionId, code);
      if (!submitResult.success) {
        return res.status(400).json({
          error: submitResult.error,
          needsRestart: submitResult.needsRestart,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const result = await completeAuthSession(sessionId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, message: 'Authentication complete' });
  });

  // GET /auth/cli/providers - List supported providers.
  app.get('/auth/cli/providers', (_req, res) => {
    return res.json({ providers: getSupportedProviders() });
  });

  // GET /auth/cli/openai/check - Check if OpenAI/Codex is authenticated.
  app.get('/auth/cli/openai/check', async (req, res) => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      if (userId && !/^[a-zA-Z0-9_-]+$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }

      let credPath: string;
      if (userId) {
        const dataDir = process.env.AGENT_RELAY_DATA_DIR || '/data';
        credPath = path.join(dataDir, 'users', userId, '.codex', 'auth.json');
      } else {
        const homedir = process.env.HOME || '/home/workspace';
        credPath = path.join(homedir, '.codex', 'auth.json');
      }

      if (!fs.existsSync(credPath)) {
        return res.json({ authenticated: false });
      }

      const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const hasToken = !!(
        creds.access_token ||
        creds.token ||
        creds.api_key ||
        creds.OPENAI_API_KEY ||
        creds.tokens?.access_token ||
        creds.tokens?.refresh_token
      );

      return res.json({ authenticated: hasToken });
    } catch {
      return res.json({ authenticated: false });
    }
  });

  // POST /api/credentials/apikey - Persist API key credential.
  app.post('/api/credentials/apikey', async (req, res) => {
    const { userId, provider, apiKey } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    try {
      const { getUserDirectoryService } = await import('@agent-relay/user-directory');
      const userDirService = getUserDirectoryService();
      const credPath = userDirService.writeApiKeyCredential(userId, provider, apiKey);

      console.log(`[credentials] Wrote ${provider} API key for user ${userId} to ${credPath}`);

      return res.json({
        success: true,
        message: `${provider} API key saved`,
        path: credPath,
      });
    } catch (err) {
      console.error(`[credentials] Failed to write ${provider} API key for user ${userId}:`, err);
      return res.status(500).json({ error: 'Failed to write credential file' });
    }
  });

  // DELETE /api/credentials/apikey - Delete provider credential files.
  app.delete('/api/credentials/apikey', async (req, res) => {
    const { userId, provider } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }

    try {
      const { getUserDirectoryService } = await import('@agent-relay/user-directory');
      const userDirService = getUserDirectoryService();
      const deletedPaths = userDirService.deleteProviderCredentials(userId, provider);

      console.log(`[credentials] Deleted ${provider} credentials for user ${userId}:`, deletedPaths);

      return res.json({
        success: true,
        deletedPaths,
      });
    } catch (err) {
      console.error(`[credentials] Failed to delete ${provider} credentials for user ${userId}:`, err);
      return res.status(500).json({ error: 'Failed to delete credential files' });
    }
  });
}
