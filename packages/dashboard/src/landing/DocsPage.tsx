/**
 * Agent Relay Cloud - Documentation Page
 *
 * Redirects to external docs site at docs.agent-relay.com
 */

import React, { useEffect } from 'react';
import { StaticPage } from './StaticPage';

export function DocsPage() {
  useEffect(() => {
    // Redirect to external docs
    window.location.href = 'https://docs.agent-relay.com/';
  }, []);

  return (
    <StaticPage
      title="Documentation"
      subtitle="Redirecting to docs.agent-relay.com..."
    >
      <p style={{ textAlign: 'center', marginTop: '32px' }}>
        You are being redirected to our documentation site.
      </p>
      <p style={{ textAlign: 'center' }}>
        If you are not redirected automatically, please click{' '}
        <a href="https://docs.agent-relay.com/">here</a>.
      </p>

      <div className="docs-nav" style={{ marginTop: '48px' }}>
        <a href="https://docs.agent-relay.com/quickstart" className="docs-nav-card">
          <h3>Quickstart Guide</h3>
          <p>Get up and running with Agent Relay in minutes.</p>
        </a>
        <a href="https://docs.agent-relay.com/concepts" className="docs-nav-card">
          <h3>Core Concepts</h3>
          <p>Learn about agents, workspaces, and messaging.</p>
        </a>
      </div>
    </StaticPage>
  );
}

export default DocsPage;
