'use client';

/**
 * /dev/log-viewer — Isolated test page for the log viewer components.
 *
 * Renders mock data through both inline (sanitized text) and the production
 * XTermLogViewer (full ANSI) side by side. Supports:
 * - Static edge-case fixtures (always available)
 * - Real worker logs loaded dynamically from /api/logs/:name
 * No WebSocket or auth required — XTermLogViewer runs in mock mode.
 */

import React, { useState, useEffect } from 'react';
import { InlineMockViewer } from './MockLogViewer';
import { XTermLogViewer } from '../../../components/XTermLogViewer';
import { STATIC_FIXTURES, rawLogToFixture, type LogFixture } from './fixtures';

interface LogAgent {
  name: string;
  loading?: boolean;
}

export default function DevLogViewerPage() {
  const [fixtures, setFixtures] = useState<LogFixture[]>(STATIC_FIXTURES);
  const [selectedFixture, setSelectedFixture] = useState<LogFixture>(STATIC_FIXTURES[0]);
  const [streaming, setStreaming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [availableAgents, setAvailableAgents] = useState<LogAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Resolve API base: check ?api= query param, otherwise try relative /api
  const getApiBase = () => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('api') || '';
  };

  // Fetch available log agents from the server
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/api/logs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        // Filter out step-* logs (internal orchestration) — show named agents only
        const agents: string[] = (data.agents || []).filter(
          (name: string) => !name.startsWith('step-')
        );
        setAvailableAgents(agents.map((name) => ({ name })));
      } catch {
        // Server not available — just use static fixtures
        console.warn('Could not fetch log agents from /api/logs — using static fixtures only');
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Load a real log file from the server
  const loadAgentLog = async (agentName: string) => {
    // Check if already loaded
    const existing = fixtures.find((f) => f.name === agentName);
    if (existing) {
      setSelectedFixture(existing);
      setReloadKey((k) => k + 1);
      return;
    }

    // Mark as loading
    setAvailableAgents((prev) =>
      prev.map((a) => (a.name === agentName ? { ...a, loading: true } : a))
    );

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/logs/${encodeURIComponent(agentName)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.found || !data.content) {
        console.warn(`No log content found for ${agentName}`);
        return;
      }

      const fixture = rawLogToFixture(agentName, data.content);
      setFixtures((prev) => [...prev, fixture]);
      setSelectedFixture(fixture);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error(`Failed to load log for ${agentName}:`, err);
    } finally {
      setAvailableAgents((prev) =>
        prev.map((a) => (a.name === agentName ? { ...a, loading: false } : a))
      );
    }
  };

  const handleFixtureChange = (fixture: LogFixture) => {
    setSelectedFixture(fixture);
    setReloadKey((k) => k + 1);
  };

  const handleReplay = () => {
    setReloadKey((k) => k + 1);
  };

  // Convert LogFixtureLine[] to mockData format for XTermLogViewer
  const mockData = selectedFixture.lines.map((line) => ({
    content: line.content,
    delay: line.delay,
  }));

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#c9d1d9]">
      {/* Header */}
      <div className="border-b border-[#21262d] bg-[#0d1117]">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-cyan">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                Log Viewer Test Page
              </h1>
              <p className="text-sm text-[#8b949e] mt-1">
                Isolated rendering tests — static fixtures + real worker logs
              </p>
            </div>
            <span className="px-2 py-1 rounded-md bg-[#d29922]/20 text-[#d29922] text-xs font-medium uppercase tracking-wider">
              Dev Only
            </span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="border-b border-[#21262d] bg-[#0d1117]/50">
        <div className="max-w-[1600px] mx-auto px-6 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Static fixture selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8b949e] uppercase tracking-wider font-medium">Static:</span>
              <div className="flex gap-1">
                {STATIC_FIXTURES.map((fixture) => (
                  <button
                    key={fixture.name}
                    onClick={() => handleFixtureChange(fixture)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      selectedFixture.name === fixture.name
                        ? 'bg-accent-cyan/20 text-accent-cyan shadow-[0_0_8px_rgba(0,217,255,0.15)]'
                        : 'bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]'
                    }`}
                  >
                    {fixture.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-px h-6 bg-[#30363d]" />

            {/* Streaming toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={streaming}
                onChange={(e) => {
                  setStreaming(e.target.checked);
                  setReloadKey((k) => k + 1);
                }}
                className="sr-only"
              />
              <div
                className={`w-8 h-4 rounded-full transition-colors ${
                  streaming ? 'bg-accent-cyan' : 'bg-[#30363d]'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${
                    streaming ? 'translate-x-4.5 ml-[18px]' : 'translate-x-0.5 ml-[2px]'
                  }`}
                />
              </div>
              <span className="text-xs text-[#8b949e]">Streaming</span>
            </label>

            {/* Replay button */}
            <button
              onClick={handleReplay}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d] transition-all flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Replay
            </button>
          </div>

          {/* Real log agents (loaded dynamically) */}
          {availableAgents.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[#8b949e] uppercase tracking-wider font-medium">Real Logs:</span>
              <div className="flex gap-1 flex-wrap">
                {availableAgents.map((agent) => {
                  const isLoaded = fixtures.some((f) => f.name === agent.name);
                  const isSelected = selectedFixture.name === agent.name;
                  return (
                    <button
                      key={agent.name}
                      onClick={() => loadAgentLog(agent.name)}
                      disabled={agent.loading}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-[#3fb950]/20 text-[#3fb950] shadow-[0_0_8px_rgba(63,185,80,0.15)]'
                          : isLoaded
                          ? 'bg-[#238636]/10 text-[#3fb950] hover:bg-[#238636]/20'
                          : 'bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]'
                      } ${agent.loading ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      {agent.loading ? '...' : agent.name}
                    </button>
                  );
                })}
              </div>
              {loadingAgents && (
                <span className="text-[10px] text-[#6e7681] animate-pulse">Loading agents...</span>
              )}
            </div>
          )}
          {!loadingAgents && availableAgents.length === 0 && (
            <div className="mt-2 text-[10px] text-[#484f58]">
              No real log agents found — start the dashboard server to load worker logs
            </div>
          )}

          {/* Fixture description */}
          <p className="text-xs text-[#6e7681] mt-2">{selectedFixture.description}</p>
        </div>
      </div>

      {/* Side-by-side viewers */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inline mode */}
          <div>
            <h2 className="text-sm font-medium text-[#8b949e] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#58a6ff]" />
              Inline Mode
              <span className="text-[10px] text-[#6e7681]">(sanitized text, no ANSI)</span>
            </h2>
            <InlineMockViewer
              key={`inline-${reloadKey}`}
              fixture={selectedFixture}
              streaming={streaming}
            />
          </div>

          {/* XTerm panel mode — uses real production component in mock mode */}
          <div>
            <h2 className="text-sm font-medium text-[#8b949e] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
              XTerm Panel Mode
              <span className="text-[10px] text-[#6e7681]">(production component, mock data)</span>
            </h2>
            <XTermLogViewer
              key={`xterm-${reloadKey}`}
              agentName={selectedFixture.name}
              mockData={mockData}
              mockStreaming={streaming}
              maxHeight="400px"
              suppressNoisyOutput={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
