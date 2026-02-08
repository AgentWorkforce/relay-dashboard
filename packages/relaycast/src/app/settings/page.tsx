'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore } from '@/lib/store';
import {
  updateWorkspace,
  fetchSystemPrompt,
  updateSystemPrompt,
} from '@/lib/relay';

function SettingsContent() {
  const apiKey = useAuthStore((s) => s.apiKey);
  const workspace = useAuthStore((s) => s.workspace);
  const setAuth = useAuthStore((s) => s.setAuth);
  const agentToken = useAuthStore((s) => s.agentToken);

  const [name, setName] = useState(workspace?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [promptMsg, setPromptMsg] = useState('');

  useEffect(() => {
    if (!apiKey) return;
    fetchSystemPrompt(apiKey)
      .then((r) => setSystemPrompt(r.prompt ?? ''))
      .catch(() => {});
  }, [apiKey]);

  useEffect(() => {
    setName(workspace?.name ?? '');
  }, [workspace?.name]);

  const handleSaveName = async () => {
    if (!apiKey || !name.trim()) return;
    setSaving(true);
    setNameMsg('');
    try {
      const updated = await updateWorkspace(apiKey, { name: name.trim() });
      if (agentToken && workspace && setAuth) {
        setAuth(apiKey, agentToken, { ...workspace, name: updated.name });
      }
      setNameMsg('Saved');
    } catch {
      setNameMsg('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!apiKey) return;
    setSavingPrompt(true);
    setPromptMsg('');
    try {
      await updateSystemPrompt(apiKey, systemPrompt);
      setPromptMsg('Saved');
    } catch {
      setPromptMsg('Failed to save');
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold text-text">Settings</h1>

      {/* Workspace name */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
          Workspace Name
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-text outline-none focus:border-accent"
          />
          <button
            onClick={handleSaveName}
            disabled={saving}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {nameMsg && (
          <p className="mt-1 text-xs text-text-muted">{nameMsg}</p>
        )}
      </section>

      {/* System prompt */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
          System Prompt
        </h2>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={10}
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleSavePrompt}
            disabled={savingPrompt}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {savingPrompt ? 'Saving...' : 'Save Prompt'}
          </button>
          {promptMsg && (
            <span className="text-xs text-text-muted">{promptMsg}</span>
          )}
        </div>
      </section>

      {/* Billing link */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
          Billing
        </h2>
        <Link
          href="/settings/billing"
          className="text-sm text-accent hover:underline"
        >
          Manage billing and usage
        </Link>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RelaycastProvider>
      <SettingsContent />
    </RelaycastProvider>
  );
}
