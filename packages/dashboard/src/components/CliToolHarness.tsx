/**
 * CliToolHarness
 *
 * Isolated per-CLI-tool harness used for manual and integration-style testing.
 * Spawns one real CLI tool instance and renders only the CLI metadata + log stream.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { XTermLogViewer } from './XTermLogViewer';

export interface CliToolHarnessConfig {
  /** Unique identifier used for CLI and agent name generation */
  id: string;
  /** Display name in the UI */
  name: string;
  /** Command string sent to /api/spawn as `cli` */
  command: string;
  /** Optional task string sent to /api/spawn */
  task?: string;
  /** Optional short description */
  description?: string;
}

export interface CliToolHarnessProps {
  /** Tool definition */
  tool: CliToolHarnessConfig;
  /** Optional class name for the wrapper card */
  className?: string;
  /** Optional deterministic agent-name generator for tests */
  nameGenerator?: (tool: CliToolHarnessConfig) => string;
}

type HarnessState = 'idle' | 'spawning' | 'running' | 'stopping' | 'error';

let harnessCounter = 0;

const defaultNameGenerator = (tool: CliToolHarnessConfig): string => {
  harnessCounter += 1;
  return `${tool.id}-${Date.now().toString(36)}-${harnessCounter.toString().padStart(3, '0')}`;
};

function getStatusLabel(state: HarnessState): string {
  switch (state) {
    case 'spawning':
      return 'starting';
    case 'stopping':
      return 'stopping';
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    case 'idle':
    default:
      return 'idle';
  }
}

function getButtonLabel(state: HarnessState, toolName: string): string {
  if (state === 'running') {
    return `Stop ${toolName}`;
  }

  if (state === 'spawning' || state === 'stopping') {
    return `${state === 'spawning' ? 'Starting' : 'Stopping'} ${toolName}...`;
  }

  return `Launch ${toolName}`;
}

export function CliToolHarness({
  tool,
  className = '',
  nameGenerator = defaultNameGenerator,
}: CliToolHarnessProps) {
  const [state, setState] = useState<HarnessState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const activeAgentNameRef = useRef<string | null>(null);

  useEffect(() => {
    activeAgentNameRef.current = agentName;
  }, [agentName]);

  useEffect(() => {
    return () => {
      const runningAgentName = activeAgentNameRef.current;
      if (!runningAgentName) return;
      void api.releaseAgent(runningAgentName);
    };
  }, []);

  const isBusy = state === 'spawning' || state === 'stopping';

  const handleToggle = useCallback(async () => {
    if (isBusy) return;

    if (state === 'running' && agentName) {
      setState('stopping');
      setError(null);

      try {
        const result = await api.releaseAgent(agentName);
        if (!result.success) {
        setState('error');
        setError(result.error || `Failed to stop ${tool.name}`);
        setSendError(null);
        return;
      }

      setAgentName(null);
      setChatInput('');
      setSendError(null);
      setState('idle');
      } catch {
        setState('error');
        setError(`Failed to stop ${tool.name}`);
      }
      return;
    }

    setState('spawning');
    setError(null);

    const name = nameGenerator(tool);
    try {
      const result = await api.spawnAgent({
        name,
        cli: tool.command,
        task: tool.task,
      });

      if (!result.success) {
        setState('error');
        setError(result.error || `Failed to launch ${tool.name}`);
        return;
      }

      setAgentName(result.name);
      setSendError(null);
      setState('running');
    } catch {
      setState('error');
      setError(`Failed to launch ${tool.name}`);
    }
  }, [agentName, isBusy, nameGenerator, state, tool]);

  const handleSendMessage = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!agentName) return;
      const message = chatInput.trim();
      if (!message || isSending) return;

      setIsSending(true);
      setSendError(null);

      try {
        const result = await api.sendMessage({
          to: agentName,
          message,
        });

        if (!result.success) {
          setSendError(result.error || `Failed to send message to ${tool.name}`);
          return;
        }

        setChatInput('');
      } catch {
        setSendError(`Failed to send message to ${tool.name}`);
      } finally {
        setIsSending(false);
      }
    },
    [agentName, chatInput, isSending, tool.name],
  );

  const statusLabel = getStatusLabel(state);
  const buttonLabel = getButtonLabel(state, tool.name);

  return (
    <section
      className={`rounded-xl border border-[#2a2d35] bg-gradient-to-b from-[#0d0f14] to-[#0a0c10] p-4 min-w-0 ${className}`}
      data-tool-id={tool.id}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#e6edf3]">{tool.name}</h2>
          <p className="mt-1 text-xs text-[#8b949e]">Command: {tool.command}</p>
          {tool.description && (
            <p className="mt-2 text-xs text-[#8b949e]">{tool.description}</p>
          )}
        </div>
        <div className="text-xs text-[#8b949e]">
          <span
            className={`rounded-full px-2 py-1 uppercase tracking-wider ${
              state === 'running'
                ? 'bg-[#3fb950]/20 text-[#3fb950]'
                : state === 'error'
                ? 'bg-[#f85149]/20 text-[#f85149]'
                : 'bg-[#30363d]/50 text-[#8b949e]'
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleToggle}
          disabled={isBusy}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            state === 'running'
              ? 'bg-[#f85149]/20 text-[#fba8a8] hover:bg-[#f85149]/30'
              : 'bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30'
          }`}
        >
          {buttonLabel}
        </button>

        {agentName && (
          <span className="text-xs text-[#8b949e]">
            Agent: <span className="text-[#c9d1d9]">{agentName}</span>
          </span>
        )}
      </div>

      {error && (
        <div
          className="mb-3 rounded-md border border-[#f85149]/40 bg-[#3d1d20] px-3 py-2 text-xs text-[#f85149]"
          role="status"
          aria-live="polite"
        >
          {error}
        </div>
      )}

      {state === 'running' && agentName ? (
        <div className="mb-3">
          <form className="flex gap-2" onSubmit={handleSendMessage}>
            <input
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={`Message ${agentName}`}
              className="min-w-0 flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-[#c9d1d9] placeholder:text-[#6e7681] focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/40"
              disabled={isSending}
              autoComplete="off"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#58a6ff]/20 px-3 py-2 text-xs font-semibold text-[#79c0ff] transition-all hover:bg-[#58a6ff]/30 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!chatInput.trim() || isSending}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
          {sendError && (
            <div className="mt-2 rounded-md border border-[#f85149]/40 bg-[#3d1d20] px-3 py-2 text-xs text-[#f85149]">
              {sendError}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-[#30363d] px-3 py-2 text-xs text-[#8b949e]">
          Start the session to send a message.
        </div>
      )}

      {state === 'running' && agentName ? (
        <XTermLogViewer
          agentName={agentName}
          maxHeight="320px"
          showHeader={true}
          key={`log-viewer-${tool.id}-${agentName}`}
          suppressNoisyOutput={false}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-[#30363d] px-3 py-4 text-xs text-[#8b949e]">
          No active session for this tool. Launch it to start a real log stream.
        </div>
      )}
    </section>
  );
}
