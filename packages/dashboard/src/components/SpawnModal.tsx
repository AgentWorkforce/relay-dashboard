/**
 * SpawnModal Component
 *
 * Modal for spawning new agent instances with configuration options.
 * Supports different agent types (claude, codex, etc.) and naming conventions.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getAgentColor, getAgentInitials } from '../lib/colors';

export type SpeakOnTrigger = 'SESSION_END' | 'CODE_WRITTEN' | 'REVIEW_REQUEST' | 'EXPLICIT_ASK' | 'ALL_MESSAGES';

export interface SpawnConfig {
  name: string;
  command: string;
  cwd?: string;
  team?: string;
  shadowMode?: 'subagent' | 'process';
  shadowOf?: string;
  shadowAgent?: string;
  shadowTriggers?: SpeakOnTrigger[];
  shadowSpeakOn?: SpeakOnTrigger[];
  continueFrom?: string;
}

function deriveShadowMode(command: string): 'subagent' | 'process' {
  const base = command.trim().split(' ')[0].toLowerCase();
  if (base.startsWith('claude') || base === 'codex' || base === 'opencode' || base === 'gemini' || base === 'droid' || base === 'cursor') return 'subagent';
  return 'process';
}

export interface SpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (config: SpawnConfig) => Promise<boolean>;
  existingAgents: string[];
  isSpawning?: boolean;
  error?: string | null;
  /** Whether running in cloud mode */
  isCloudMode?: boolean;
  /** Active workspace ID for provider setup redirect */
  workspaceId?: string;
  /** Agent defaults from settings */
  agentDefaults?: {
    defaultCliType: string | null;
    defaultModels: {
      claude: string;
      cursor: string;
      codex: string;
      gemini: string;
    };
  };
  /** Available workspace repos (cloud mode) */
  repos?: Array<{ id: string; githubFullName: string }>;
  /** Currently active repo ID (cloud mode) */
  activeRepoId?: string;
  /** Connected provider IDs (cloud mode) - used to disable unconnected providers */
  connectedProviders?: string[];
}

/** Model options for Claude agents */
export const CLAUDE_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

type ClaudeModel = string;

/** Model options for Cursor agents */
export const CURSOR_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
  { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
  { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
  { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { value: 'gpt-5.2-codex-high', label: 'GPT-5.2 Codex High' },
  { value: 'gpt-5.2-codex-low', label: 'GPT-5.2 Codex Low' },
  { value: 'gpt-5.2-codex-xhigh', label: 'GPT-5.2 Codex Extra High' },
  { value: 'gpt-5.2-codex-fast', label: 'GPT-5.2 Codex Fast' },
  { value: 'gpt-5.2-codex-high-fast', label: 'GPT-5.2 Codex High Fast' },
  { value: 'gpt-5.2-codex-low-fast', label: 'GPT-5.2 Codex Low Fast' },
  { value: 'gpt-5.2-codex-xhigh-fast', label: 'GPT-5.2 Codex Extra High Fast' },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  { value: 'gpt-5.1-codex-max-high', label: 'GPT-5.1 Codex Max High' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.2-high', label: 'GPT-5.2 High' },
  { value: 'gpt-5.1-high', label: 'GPT-5.1 High' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { value: 'composer-1', label: 'Composer 1' },
  { value: 'grok', label: 'Grok' },
];

type CursorModel = string;

/** Model options for Codex agents */
export const CODEX_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex — Frontier agentic coding model' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex — Latest frontier agentic coding model' },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max — Deep and fast reasoning' },
  { value: 'gpt-5.2', label: 'GPT-5.2 — Frontier model, knowledge & reasoning' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini — Cheaper, faster' },
];

type CodexModel = string;

/** Model options for Gemini agents */
export const GEMINI_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
];

type GeminiModel = string;

const AGENT_TEMPLATES = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    description: 'Claude Code CLI agent',
    icon: '🤖',
    providerId: 'anthropic', // Maps to provider credential ID
    supportsModelSelection: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    description: 'OpenAI Codex agent',
    icon: '⚡',
    providerId: 'codex',
    supportsModelSelection: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    description: 'Google Gemini CLI agent',
    icon: '💎',
    providerId: 'google',
    supportsModelSelection: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    description: 'OpenCode AI agent',
    icon: '🔷',
    providerId: 'opencode',
    comingSoon: true, // Not yet fully tested
  },
  {
    id: 'droid',
    name: 'Droid',
    command: 'droid',
    description: 'Factory Droid agent',
    icon: '🤖',
    providerId: 'droid',
    comingSoon: true, // Not yet fully tested
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor',
    description: 'Cursor AI agent',
    icon: '📝',
    providerId: 'cursor',
    supportsModelSelection: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    command: '',
    description: 'Custom command',
    icon: '🔧',
    providerId: null, // Custom commands don't require credentials check
  },
];

export function SpawnModal({
  isOpen,
  onClose,
  onSpawn,
  existingAgents,
  isSpawning = false,
  error,
  isCloudMode = false,
  workspaceId,
  agentDefaults,
  repos,
  activeRepoId,
  connectedProviders,
}: SpawnModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState(AGENT_TEMPLATES[0]);
  const [name, setName] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>('sonnet');
  const [selectedCursorModel, setSelectedCursorModel] = useState<CursorModel>('opus-4.5-thinking');
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>('gpt-5.2-codex');
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<GeminiModel>('gemini-2.5-pro');
  const [cwd, setCwd] = useState('');
  const [selectedRepoId, setSelectedRepoId] = useState<string | undefined>(activeRepoId);
  const [team, setTeam] = useState('');
  const [continueFromPrevious, setContinueFromPrevious] = useState(false);
  const [isShadow, setIsShadow] = useState(false);
  const [shadowOf, setShadowOf] = useState('');
  const [shadowAgent, setShadowAgent] = useState('');
  const [shadowSpeakOn, setShadowSpeakOn] = useState<SpeakOnTrigger[]>(['EXPLICIT_ASK']);
  const [localError, setLocalError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Build effective command, always including model flag for Claude, Cursor, and Codex
  const effectiveCommand = useMemo(() => {
    if (selectedTemplate.id === 'custom') {
      return customCommand;
    }
    // For Claude, always append model flag
    if (selectedTemplate.id === 'claude') {
      return `${selectedTemplate.command} --model ${selectedModel}`;
    }
    // For Cursor, always append model flag
    if (selectedTemplate.id === 'cursor') {
      return `${selectedTemplate.command} --model ${selectedCursorModel}`;
    }
    // For Codex, always append model flag
    if (selectedTemplate.id === 'codex') {
      return `${selectedTemplate.command} --model ${selectedCodexModel}`;
    }
    // For Gemini, always append model flag
    if (selectedTemplate.id === 'gemini') {
      return `${selectedTemplate.command} --model ${selectedGeminiModel}`;
    }
    return selectedTemplate.command;
  }, [selectedTemplate, customCommand, selectedModel, selectedCursorModel, selectedCodexModel, selectedGeminiModel]);

  const shadowMode = useMemo(() => deriveShadowMode(effectiveCommand), [effectiveCommand]);

  const SPEAK_ON_OPTIONS: { value: SpeakOnTrigger; label: string; description: string }[] = [
    { value: 'EXPLICIT_ASK', label: 'Explicit Ask', description: 'When directly asked' },
    { value: 'SESSION_END', label: 'Session End', description: 'When session ends' },
    { value: 'CODE_WRITTEN', label: 'Code Written', description: 'When code is written' },
    { value: 'REVIEW_REQUEST', label: 'Review Request', description: 'When review requested' },
    { value: 'ALL_MESSAGES', label: 'All Messages', description: 'On every message' },
  ];

  const suggestedName = useCallback(() => {
    const prefix = selectedTemplate.id === 'claude' ? 'claude' : selectedTemplate.id;
    let num = 1;
    while (existingAgents.includes(`${prefix}-${num}`)) {
      num++;
    }
    return `${prefix}-${num}`;
  }, [selectedTemplate, existingAgents]);

  useEffect(() => {
    if (isOpen) {
      // Determine default template based on settings
      // In cloud mode, also skip templates whose provider isn't connected
      const isTemplateAvailable = (t: typeof AGENT_TEMPLATES[number]) => {
        if (t.comingSoon && isCloudMode) return false;
        if (connectedProviders && t.providerId && !connectedProviders.includes(t.providerId)) return false;
        return true;
      };
      const defaultTemplateId = agentDefaults?.defaultCliType;
      const defaultTemplate = defaultTemplateId
        ? AGENT_TEMPLATES.find(t => t.id === defaultTemplateId && isTemplateAvailable(t))
          ?? AGENT_TEMPLATES.find(t => isTemplateAvailable(t))
          ?? AGENT_TEMPLATES[0]
        : AGENT_TEMPLATES.find(t => isTemplateAvailable(t)) ?? AGENT_TEMPLATES[0];

      setSelectedTemplate(defaultTemplate);
      setName('');
      setCustomCommand('');
      // Use settings-based model defaults with fallbacks
      setSelectedModel(agentDefaults?.defaultModels?.claude ?? 'sonnet');
      setSelectedCursorModel(agentDefaults?.defaultModels?.cursor ?? 'opus-4.5-thinking');
      setSelectedCodexModel(agentDefaults?.defaultModels?.codex ?? 'gpt-5.2-codex');
      setSelectedGeminiModel(agentDefaults?.defaultModels?.gemini ?? 'gemini-2.5-pro');
      setCwd('');
      setSelectedRepoId(activeRepoId);
      setTeam('');
      setContinueFromPrevious(false);
      setIsShadow(false);
      setShadowOf('');
      setShadowAgent('');
      setShadowSpeakOn(['EXPLICIT_ASK']);
      setLocalError(null);
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen, agentDefaults, activeRepoId, repos]);

  const validateName = useCallback(
    (value: string): string | null => {
      if (!value.trim()) {
        return 'Name is required';
      }
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value)) {
        return 'Name must start with a letter and contain only letters, numbers, and hyphens';
      }
      if (existingAgents.includes(value)) {
        return 'An agent with this name already exists';
      }
      return null;
    },
    [existingAgents]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalName = name.trim() || suggestedName();
    const nameError = validateName(finalName);
    if (nameError) {
      setLocalError(nameError);
      return;
    }

    const command = effectiveCommand;
    if (!command.trim()) {
      setLocalError('Command is required');
      return;
    }

    if (isShadow && !shadowOf) {
      setLocalError('Please select an agent to shadow');
      return;
    }

    setLocalError(null);

    // Derive cwd: in cloud mode with repos, use selected repo name; otherwise use text input
    let effectiveCwd: string | undefined;
    if (isCloudMode && repos && repos.length > 0 && selectedRepoId) {
      if (selectedRepoId === '__all__') {
        // Coordinator mode: no cwd, agent starts at workspace root with access to all repos
        effectiveCwd = undefined;
      } else {
        const selectedRepo = repos.find(r => r.id === selectedRepoId);
        if (selectedRepo) {
          effectiveCwd = selectedRepo.githubFullName.split('/').pop();
        }
      }
    } else {
      effectiveCwd = cwd.trim() || undefined;
    }

    const success = await onSpawn({
      name: finalName,
      command: command.trim(),
      cwd: effectiveCwd,
      team: team.trim() || undefined,
      shadowMode: shadowMode,
      shadowOf: isShadow ? shadowOf : undefined,
      shadowAgent: shadowAgent.trim() || undefined,
      shadowTriggers: isShadow ? shadowSpeakOn : undefined,
      shadowSpeakOn: isShadow ? shadowSpeakOn : undefined,
      continueFrom: continueFromPrevious ? finalName : undefined,
    });

    if (success) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  const colors = name ? getAgentColor(name) : getAgentColor(suggestedName());
  const displayError = error || localError;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative bg-bg-primary border border-border rounded-xl w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto shadow-modal animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {isSpawning && (
          <SpawningOverlay
            agentName={name.trim() || suggestedName()}
            colors={colors}
          />
        )}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="m-0 text-lg font-semibold text-text-primary">Spawn New Agent</h2>
          <button
            className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-md text-text-muted cursor-pointer transition-all duration-150 hover:bg-bg-hover hover:text-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* No providers connected warning */}
          {connectedProviders && connectedProviders.length === 0 && (
            <div className="mb-5 p-4 rounded-lg border border-red-400/30 bg-red-400/10">
              <p className="text-sm text-red-400 font-medium mb-1">No AI providers connected</p>
              <p className="text-xs text-text-muted">
                Connect an AI provider in your{' '}
                <a
                  href={workspaceId ? `/app?workspace=${workspaceId}&tab=providers` : '/providers'}
                  className="text-accent underline"
                >
                  workspace settings
                </a>
                {' '}to spawn agents.
              </p>
            </div>
          )}
          {/* Agent Type Selection */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-text-primary mb-2">Agent Type</label>
            <div className="grid grid-cols-3 gap-2">
              {AGENT_TEMPLATES.map((template) => {
                // Only disable "coming soon" providers in cloud mode - locally they might be available
                const isComingSoon = template.comingSoon && isCloudMode;
                // In cloud mode, disable providers that aren't connected (skip for custom/null providerId)
                const isProviderMissing = connectedProviders && template.providerId
                  ? !connectedProviders.includes(template.providerId)
                  : false;
                const isDisabled = isComingSoon || isProviderMissing;
                return (
                <button
                  key={template.id}
                  type="button"
                  disabled={isDisabled}
                  className={`
                    flex flex-col items-center gap-1 py-3 px-2 border-2 rounded-lg font-sans transition-all duration-150 relative
                    ${isDisabled
                      ? 'opacity-50 cursor-not-allowed bg-bg-hover border-transparent'
                      : selectedTemplate.id === template.id
                        ? 'bg-accent/10 border-accent cursor-pointer'
                        : 'bg-bg-hover border-transparent hover:bg-bg-active cursor-pointer'
                    }
                  `}
                  onClick={() => !isDisabled && setSelectedTemplate(template)}
                >
                  {isComingSoon && (
                    <span className="absolute top-1 right-1 px-1.5 py-0.5 bg-amber-400/20 text-amber-400 text-[10px] font-medium rounded">
                      Soon
                    </span>
                  )}
                  {isProviderMissing && !isComingSoon && (
                    <span className="absolute top-1 right-1 px-1.5 py-0.5 bg-red-400/20 text-red-400 text-[10px] font-medium rounded">
                      Not Connected
                    </span>
                  )}
                  <span className={`text-2xl ${isDisabled ? 'grayscale' : ''}`}>{template.icon}</span>
                  <span className="text-sm font-semibold text-text-primary">{template.name}</span>
                  <span className="text-xs text-text-muted text-center">{template.description}</span>
                </button>
                );
              })}
            </div>
          </div>

          {/* Model Selection (Claude only) */}
          {selectedTemplate.id === 'claude' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="claude-model">
                Model
              </label>
              <select
                id="claude-model"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ClaudeModel)}
                disabled={isSpawning}
              >
                {CLAUDE_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Model Selection (Cursor only) */}
          {selectedTemplate.id === 'cursor' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="cursor-model">
                Model
              </label>
              <select
                id="cursor-model"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                value={selectedCursorModel}
                onChange={(e) => setSelectedCursorModel(e.target.value as CursorModel)}
                disabled={isSpawning}
              >
                {CURSOR_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Model Selection (Codex only) */}
          {selectedTemplate.id === 'codex' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="codex-model">
                Model
              </label>
              <select
                id="codex-model"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                value={selectedCodexModel}
                onChange={(e) => setSelectedCodexModel(e.target.value as CodexModel)}
                disabled={isSpawning}
              >
                {CODEX_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Model Selection (Gemini only) */}
          {selectedTemplate.id === 'gemini' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="gemini-model">
                Model
              </label>
              <select
                id="gemini-model"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                value={selectedGeminiModel}
                onChange={(e) => setSelectedGeminiModel(e.target.value as GeminiModel)}
                disabled={isSpawning}
              >
                {GEMINI_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Agent Name */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="agent-name">
              Agent Name
            </label>
            <div className="flex items-center gap-3">
              <div
                className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold"
                style={{ backgroundColor: colors.primary, color: colors.text }}
              >
                {getAgentInitials(name || suggestedName())}
              </div>
              <input
                ref={nameInputRef}
                id="agent-name"
                type="text"
                className="flex-1 py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-transparent text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted placeholder:text-text-muted"
                placeholder={suggestedName()}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setLocalError(null);
                }}
                disabled={isSpawning}
              />
            </div>
          </div>

          {/* Team Assignment - moved higher for prominence */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="agent-team">
              Team <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input
              id="agent-team"
              type="text"
              className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-transparent text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted placeholder:text-text-muted"
              placeholder="e.g., frontend, backend, infra"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              disabled={isSpawning}
            />
          </div>

          {/* Custom Command (if custom template) */}
          {selectedTemplate.id === 'custom' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="agent-command">
                Command
              </label>
              <input
                id="agent-command"
                type="text"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-transparent text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted placeholder:text-text-muted"
                placeholder="e.g., python agent.py"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                disabled={isSpawning}
              />
            </div>
          )}

          {/* Repository (cloud) / Working Directory (local) */}
          {isCloudMode && repos && repos.length > 0 ? (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="agent-repo">
                Repository
              </label>
              <select
                id="agent-repo"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-transparent text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                value={selectedRepoId || ''}
                onChange={(e) => setSelectedRepoId(e.target.value)}
                disabled={isSpawning}
              >
                {repos.length > 1 && (
                  <option value="__all__">All Repositories (Coordinator)</option>
                )}
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.githubFullName}
                  </option>
                ))}
              </select>
              {selectedRepoId === '__all__' && (
                <p className="mt-1.5 text-xs text-accent-purple">
                  Agent will have access to all repositories in this workspace
                </p>
              )}
            </div>
          ) : (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-text-primary mb-2" htmlFor="agent-cwd">
                Working Directory <span className="font-normal text-text-muted">(optional)</span>
              </label>
              <input
                id="agent-cwd"
                type="text"
                className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-transparent text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted placeholder:text-text-muted"
                placeholder="Current directory"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                disabled={isSpawning}
              />
            </div>
          )}

          {/* Resume from Previous Session */}
          <div className="mb-5 p-4 border border-border rounded-lg bg-bg-hover/50">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-semibold text-text-primary">
                  Resume Previous Session
                </label>
                <span className="text-xs text-text-muted">
                  Inject context from this agent's last session
                </span>
              </div>
              <button
                type="button"
                className={`
                  relative w-11 h-6 rounded-full transition-colors duration-200
                  ${continueFromPrevious ? 'bg-accent' : 'bg-bg-active'}
                `}
                onClick={() => setContinueFromPrevious(!continueFromPrevious)}
                disabled={isSpawning}
                aria-pressed={continueFromPrevious}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-sm
                    ${continueFromPrevious ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>

          {/* Shadow Agent Configuration */}
          <div className="mb-5 p-4 border border-border rounded-lg bg-bg-hover/50">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="block text-sm font-semibold text-text-primary">
                  Shadow Mode
                </label>
                <span className="text-xs text-text-muted">
                  Shadow execution: {shadowMode === 'subagent' ? 'Subagent (in-process)' : 'Process (separate)'}
                </span>
              </div>
              <button
                type="button"
                className={`
                  relative w-11 h-6 rounded-full transition-colors duration-200
                  ${isShadow ? 'bg-accent' : 'bg-bg-active'}
                `}
                onClick={() => setIsShadow(!isShadow)}
                disabled={isSpawning}
                aria-pressed={isShadow}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-sm
                    ${isShadow ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>

            {isShadow && (
              <>
                {/* Primary Agent Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-text-secondary mb-2" htmlFor="shadow-of">
                    Shadow Agent
                  </label>
                  <select
                    id="shadow-of"
                    className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted"
                    value={shadowOf}
                    onChange={(e) => setShadowOf(e.target.value)}
                    disabled={isSpawning}
                  >
                    <option value="">Select an agent to shadow...</option>
                    {existingAgents.map((agent) => (
                      <option key={agent} value={agent}>
                        {agent}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Shadow Agent Profile (optional) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-text-secondary mb-2" htmlFor="shadow-agent">
                    Shadow Agent Profile <span className="font-normal text-text-muted">(optional)</span>
                  </label>
                  <input
                    id="shadow-agent"
                    type="text"
                    className="w-full py-2.5 px-3.5 border border-border rounded-md text-sm font-sans outline-none bg-bg-primary text-text-primary transition-colors duration-150 focus:border-accent disabled:bg-bg-hover disabled:text-text-muted placeholder:text-text-muted"
                    placeholder="e.g., shadow-reviewer"
                    value={shadowAgent}
                    onChange={(e) => setShadowAgent(e.target.value)}
                    disabled={isSpawning}
                  />
                </div>

                {/* Speak On Triggers */}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Speak When
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SPEAK_ON_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`
                          py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-150 border
                          ${shadowSpeakOn.includes(option.value)
                            ? 'bg-accent/20 border-accent text-accent'
                            : 'bg-bg-primary border-border text-text-secondary hover:bg-bg-active hover:text-text-primary'
                          }
                        `}
                        onClick={() => {
                          if (shadowSpeakOn.includes(option.value)) {
                            setShadowSpeakOn(shadowSpeakOn.filter(t => t !== option.value));
                          } else {
                            setShadowSpeakOn([...shadowSpeakOn, option.value]);
                          }
                        }}
                        disabled={isSpawning}
                        title={option.description}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>


          {/* Error Display */}
          {displayError && (
            <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/30 rounded-md text-error text-sm mb-5">
              <ErrorIcon />
              <span>{displayError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              className="flex items-center gap-1.5 py-2.5 px-4 border-none rounded-md text-sm font-medium cursor-pointer font-sans transition-all duration-150 bg-bg-hover text-text-secondary hover:bg-bg-active hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={isSpawning}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 py-2.5 px-4 border-none rounded-md text-sm font-medium cursor-pointer font-sans transition-all duration-150 bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSpawning}
            >
              <RocketIcon />
              Spawn Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

const SPAWNING_MESSAGES = [
  'Initializing agent environment...',
  'Loading model configuration...',
  'Establishing communication channel...',
  'Preparing workspace...',
  'Almost ready...',
];

function SpawningOverlay({ agentName, colors }: { agentName: string; colors: { primary: string; text: string } }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const msgInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SPAWNING_MESSAGES.length);
    }, 2400);
    return () => clearInterval(msgInterval);
  }, []);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);
    return () => clearInterval(dotInterval);
  }, []);

  const initials = getAgentInitials(agentName);

  return (
    <div className="absolute inset-0 bg-bg-primary/95 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-xl">
      {/* Pulsing agent avatar */}
      <div className="relative mb-6">
        <div
          className="absolute inset-0 rounded-full animate-ping opacity-20"
          style={{ backgroundColor: colors.primary }}
        />
        <div
          className="relative w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold animate-pulse"
          style={{ backgroundColor: colors.primary, color: colors.text }}
        >
          {initials}
        </div>
      </div>

      {/* Spawning label */}
      <div className="text-lg font-semibold text-text-primary mb-2">
        Spawning {agentName}{dots}
      </div>

      {/* Cycling status message */}
      <div
        className="text-sm text-text-muted transition-opacity duration-300 mb-6"
        key={messageIndex}
        style={{ animation: 'fadeInUp 0.3s ease-out' }}
      >
        {SPAWNING_MESSAGES[messageIndex]}
      </div>

      {/* Progress bar */}
      <div className="w-48 h-1 bg-bg-hover rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            backgroundColor: colors.primary,
            animation: 'spawningProgress 2.4s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spawningProgress {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}

