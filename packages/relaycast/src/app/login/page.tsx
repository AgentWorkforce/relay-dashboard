'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { validateApiKey, registerHumanAgent, rotateToken } from '@/lib/relay';

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const workspace = await validateApiKey(apiKey);

      let agentToken: string;
      try {
        const res = await registerHumanAgent(apiKey);
        agentToken = res.token;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already exists')) {
          const rotated = await rotateToken(apiKey, 'Human');
          agentToken = rotated.token;
        } else {
          throw err;
        }
      }

      setAuth(apiKey, agentToken, {
        name: workspace.name,
        plan: workspace.plan,
      });

      window.location.href = '/';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-card p-8">
        <h1 className="mb-2 text-2xl font-semibold text-text">Relaycast</h1>
        <p className="mb-6 text-sm text-text-muted">
          Enter your workspace API key to connect.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="api-key"
            className="mb-1 block text-sm font-medium text-text-muted"
          >
            API Key
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="rk_live_..."
            autoFocus
            className="mb-4 w-full rounded border border-border bg-bg-elevated px-3 py-2 text-sm text-text placeholder-text-muted outline-none focus:border-accent"
          />

          {error && (
            <p className="mb-4 text-sm text-red" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!apiKey.trim() || loading}
            className="w-full rounded bg-accent py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
