'use client';

/**
 * InlineMockViewer — Standalone inline log viewer for testing.
 *
 * Renders sanitized log content (ANSI stripped) with direct data injection.
 * Used on the /dev/log-viewer test page alongside the production XTermLogViewer
 * (in mock mode) for side-by-side comparison.
 */

import React, { useRef, useEffect, useState } from 'react';
import { sanitizeLogContent, isSpinnerFragment } from '../../../lib/sanitize-logs';
import type { LogFixtureLine, LogFixture } from './fixtures';

interface InlineMockViewerProps {
  fixture: LogFixture;
  streaming?: boolean;
}

export function InlineMockViewer({ fixture, streaming = false }: InlineMockViewerProps) {
  const [lines, setLines] = useState<LogFixtureLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    if (!streaming) {
      setLines(fixture.lines);
      return;
    }

    // Streaming mode: feed lines with delays
    setLines([]);
    (async () => {
      for (const line of fixture.lines) {
        if (cancelled) break;
        if (line.delay) {
          await new Promise((r) => setTimeout(r, line.delay));
        }
        if (cancelled) break;
        setLines((prev) => [...prev, line]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fixture, streaming]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const filteredLines = lines.filter((line) => {
    const stripped = sanitizeLogContent(line.content).trim();
    if (stripped.length === 0) return false;
    if (isSpinnerFragment(stripped)) return false;
    return true;
  });

  return (
    <div
      className="rounded-lg overflow-hidden border border-[#2a2d35]"
      style={{
        background: 'linear-gradient(180deg, #0d0f14 0%, #12151c 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02), 0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[#2a2d35]"
        style={{
          background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
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
          <span className="text-xs font-medium text-accent-cyan">
            Inline Mode
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-[#238636]/20 text-[10px] text-[#3fb950] uppercase tracking-wider">
            mock
          </span>
        </div>
        <span className="text-[10px] text-[#6e7681] font-mono">
          {filteredLines.length} lines
        </span>
      </div>
      <div
        ref={scrollRef}
        className="font-mono text-xs leading-relaxed p-3 overflow-y-auto"
        style={{ maxHeight: '400px' }}
      >
        {filteredLines.map((line, idx) => {
          const sanitized = sanitizeLogContent(line.content);
          const typeClass =
            line.type === 'stderr'
              ? 'text-[#f85149]'
              : line.type === 'system'
              ? 'text-[#58a6ff] italic'
              : 'text-[#c9d1d9]';
          return (
            <div key={idx} className={`${typeClass} leading-5 whitespace-pre-wrap break-all`}>
              {sanitized}
            </div>
          );
        })}
        {filteredLines.length === 0 && (
          <div className="text-[#484f58] italic flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#484f58] animate-pulse" />
            {streaming ? 'Streaming...' : 'No output'}
          </div>
        )}
      </div>
    </div>
  );
}
