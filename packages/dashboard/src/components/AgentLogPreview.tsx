/**
 * AgentLogPreview
 *
 * Compact streaming log preview intended for embedding in the message list while an agent is processing.
 * Shows a small tail of recent stdout/stderr lines with a one-click expand affordance.
 */

import React, { useMemo } from 'react';
import { useAgentLogs } from './hooks/useAgentLogs';
import { getAgentColor } from '../lib/colors';

export interface AgentLogPreviewProps {
  agentName: string;
  lines?: number;
  compact?: boolean;
  onExpand?: () => void;
  className?: string;
}

export function AgentLogPreview({
  agentName,
  lines = 2,
  compact = false,
  onExpand,
  className = '',
}: AgentLogPreviewProps) {
  const { logs, isConnected, isConnecting, error } = useAgentLogs({
    agentName,
    autoConnect: true,
    maxLines: 50,
  });

  const colors = getAgentColor(agentName);

  const previewLines = useMemo(() => {
    const spinnerPattern = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒●○◉◎|\\\/\-*.\u2800-\u28FF]+$/;

    const allLines: string[] = [];
    for (const log of logs) {
      if (log.type === 'system') continue;
      const sanitized = sanitizeLogContent(log.content);
      for (const rawLine of sanitized.split('\n')) {
        const trimmed = rawLine.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.length <= 2 && spinnerPattern.test(trimmed)) continue;
        allLines.push(rawLine.replace(/\s+$/g, ''));
      }
    }

    return allLines.slice(-Math.max(1, lines));
  }, [logs, lines]);

  const badge = (() => {
    if (isConnecting) return { label: 'connecting', cls: 'bg-[#d29922]/15 text-[#d29922]' };
    if (isConnected) return { label: 'live', cls: 'bg-[#238636]/15 text-[#3fb950]' };
    if (error) return { label: 'error', cls: 'bg-[#f85149]/15 text-[#f85149]' };
    return { label: 'offline', cls: 'bg-[#484f58]/15 text-[#8b949e]' };
  })();

  return (
    <div
      className={`mt-2 rounded-lg border ${className}`}
      style={{
        borderColor: `${colors.primary}35`,
        background: 'linear-gradient(180deg, rgba(13,15,20,0.9) 0%, rgba(18,21,28,0.9) 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
    >
      <div className={`flex items-center justify-between ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} border-b border-[#2a2d35]/70`}>
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon />
          <span className="text-[11px] font-medium truncate" style={{ color: colors.primary }}>
            Logs
          </span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        {onExpand && (
          <button
            type="button"
            className="p-1.5 rounded-lg hover:bg-[#21262d] text-[#8b949e] hover:text-accent-cyan transition-all duration-200"
            onClick={onExpand}
            title="Expand logs"
          >
            <ExpandIcon />
          </button>
        )}
      </div>

      <div className={`${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} font-mono text-[11px] leading-4`}>
        {previewLines.length > 0 ? (
          previewLines.map((line, idx) => (
            <div key={idx} className="text-[#c9d1d9] truncate">
              {line}
            </div>
          ))
        ) : (
          <div className="text-[#8b949e] italic">
            {error?.message || 'Waiting for output...'}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[#8b949e]"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/**
 * Strip ANSI escape codes (including degraded sequences like "[38;5;216m")
 * and control characters so logs render as clean text.
 */
function sanitizeLogContent(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove OSC sequences (like window title): \x1b]...(\x07|\x1b\\)
  result = result.replace(/\x1b\].*?(?:\x07|\x1b\\)/gs, '');

  // Remove DCS (Device Control String) sequences: \x1bP...\x1b\\
  result = result.replace(/\x1bP.*?\x1b\\/gs, '');

  // Remove standard ANSI escape sequences (CSI, SGR, etc.)
  result = result.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

  // Remove single-character escapes
  result = result.replace(/\x1b[@-Z\\-_]/g, '');

  // Remove orphaned CSI sequences that lost their escape byte
  result = result.replace(/^\[\??\d+[hlKJHfABCDGPXsu]/gm, '');

  // Remove literal SGR sequences that show up without ESC (e.g. "[38;5;216m")
  result = result.replace(/\[\d+(?:;\d+)*m/g, '');

  // Remove carriage returns/backspaces and other control chars (except newline/tab)
  result = result.replace(/\r/g, '');
  result = result.replace(/.\x08/g, '');
  result = result.replace(/\x08+/g, '');
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  return result;
}
