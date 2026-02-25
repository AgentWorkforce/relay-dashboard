/**
 * /dev/cli-tools
 *
 * Isolated, manually testable CLI tool harness page.
 * Each card is independent and uses real `/api/spawn`, `/api/spawned/:name`,
 * and websocket log streaming. No mocked fixtures are used.
 */

'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CliToolHarness, type CliToolHarnessConfig } from '../../../components/CliToolHarness';

const CLI_TOOLS: CliToolHarnessConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    description: 'Spawns a real Claude CLI tool and streams its process logs.',
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    description: 'Spawns a real Codex CLI tool and streams its process logs.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    description: 'Spawns a real Gemini CLI tool and streams its process logs.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor',
    description: 'Spawns a real Cursor CLI tool and streams its process logs.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    description: 'Spawns a real OpenCode CLI tool and streams its process logs.',
  },
  {
    id: 'droid',
    name: 'Droid',
    command: 'droid',
    description: 'Spawns a real Droid CLI tool and streams its process logs.',
  },
];

function CliToolsHarnessContent() {
  const searchParams = useSearchParams();
  const selectedTool = searchParams.get('tool') || searchParams.get('cli');
  const normalizedTool = selectedTool?.trim().toLowerCase();
  const selectedTools = normalizedTool
    ? CLI_TOOLS.filter((tool) =>
        tool.id === normalizedTool ||
        tool.command.toLowerCase() === normalizedTool ||
        tool.name.toLowerCase() === normalizedTool
      )
    : CLI_TOOLS;
  const toolsToRender = selectedTools.length === 0 ? CLI_TOOLS : selectedTools;

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#c9d1d9]">
      <div className="border-b border-[#21262d] bg-[#0d1117]">
        <div className="mx-auto max-w-[1400px] px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#58a6ff]" />
                CLI Tool Harness
              </h1>
              <p className="mt-1 text-sm text-[#8b949e]">
                {selectedTool ? `Focused tool: ${selectedTool}` : 'Real CLI launch + live XTerm log stream per tool.'} No mocks.
              </p>
            </div>
            <span className="rounded-md bg-[#3fb950]/20 px-2.5 py-1 text-xs font-medium text-[#3fb950]">
              Manual + integration testing
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2">
          {selectedTools.length === 0 && (
            <div className="rounded-lg border border-[#3fb950]/40 bg-[#1f2937] px-3 py-4 text-sm text-[#7c8594]">
              No matching tool found for "{selectedTool}". Showing all available tools.
            </div>
          )}
          {toolsToRender.map((tool) => (
            <CliToolHarness key={tool.id} tool={tool} />
          ))}
        </div>
      </main>
    </div>
  );
}

function CliToolsLoadingFallback() {
  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#c9d1d9]">
      <div className="border-b border-[#21262d] bg-[#0d1117]">
        <div className="mx-auto max-w-[1400px] px-6 py-5">
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#58a6ff]" />
            CLI Tool Harness
          </h1>
        </div>
      </div>
      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="rounded-lg border border-[#58a6ff]/30 bg-[#1f2937] px-3 py-4 text-sm text-[#7c8594]">
          Initializing CLI tools…
        </div>
      </main>
    </div>
  );
}

export default function CliToolsHarnessPage() {
  return (
    <Suspense fallback={<CliToolsLoadingFallback />}>
      <CliToolsHarnessContent />
    </Suspense>
  );
}
