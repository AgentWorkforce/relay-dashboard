/**
 * IntegrationConnect - External service integration grid
 *
 * Displays available integrations that give agents context about the work
 * they're going to do. All integrations are coming soon.
 */

import React from 'react';

interface IntegrationProvider {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface IntegrationConnectProps {
  workspaceId: string;
  csrfToken?: string;
}

const PROVIDERS: IntegrationProvider[] = [
  { id: 'slack', name: 'Slack', color: '#4A154B', description: 'Team messaging and notifications' },
  { id: 'linear', name: 'Linear', color: '#5E6AD2', description: 'Issue tracking and project management' },
  { id: 'jira', name: 'Jira', color: '#0052CC', description: 'Issue and project tracking' },
  { id: 'notion', name: 'Notion', color: '#191919', description: 'Notes and documentation' },
  { id: 'google-docs', name: 'Google Docs', color: '#4285F4', description: 'Document collaboration' },
  { id: 'gmail', name: 'Gmail', color: '#EA4335', description: 'Email integration' },
  { id: 'outlook', name: 'Outlook', color: '#0078D4', description: 'Microsoft email and calendar' },
  { id: 'datadog', name: 'Datadog', color: '#632CA6', description: 'Infrastructure monitoring' },
  { id: 'sentry', name: 'Sentry', color: '#362D59', description: 'Error tracking' },
  { id: 'vercel', name: 'Vercel', color: '#171717', description: 'Frontend deployment' },
  { id: 'netlify', name: 'Netlify', color: '#00C7B7', description: 'Web hosting and deployment' },
  { id: 'confluence', name: 'Confluence', color: '#172B4D', description: 'Team documentation' },
];

export function IntegrationConnect(_props: IntegrationConnectProps) {
  return (
    <div className="space-y-5">
      {/* Explanation */}
      <div className="p-4 bg-gradient-to-r from-accent-cyan/10 to-accent-purple/10 border border-accent-cyan/20 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-cyan/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <IntegrationIcon className="text-accent-cyan" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">Why connect integrations?</h4>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Integrations give your agents context about the work they're going to do. When connected, agents can pull in relevant issues, documents, messages, and monitoring data to make better decisions and produce higher quality results.
            </p>
          </div>
        </div>
      </div>

      {/* Coming Soon banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-400/10 border border-amber-400/20 rounded-lg">
        <span className="px-2.5 py-1 bg-amber-400/20 text-amber-400 text-xs font-bold uppercase tracking-wider rounded">
          Coming Soon
        </span>
        <p className="text-xs text-amber-400/80">
          Integrations are not yet available. We're working on bringing these to you soon.
        </p>
      </div>

      {/* Provider grid - 4 per row */}
      <div className="grid grid-cols-4 gap-3">
        {PROVIDERS.map(provider => (
          <div
            key={provider.id}
            className="relative p-4 bg-bg-tertiary rounded-xl border border-border-subtle opacity-60"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: provider.color }}
              >
                {provider.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-text-primary truncate">{provider.name}</h4>
                <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{provider.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
