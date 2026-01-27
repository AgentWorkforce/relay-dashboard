/**
 * Agent Relay Cloud - Security Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function SecurityPage() {
  return (
    <StaticPage
      title="Security"
      subtitle="How we protect your code and data."
    >
      <h2>Data Handling</h2>
      <ul>
        <li>Your source code is processed in isolated, ephemeral containers</li>
        <li>Repository access tokens are scoped to minimum required permissions</li>
        <li>All data is encrypted in transit using TLS</li>
        <li>Credentials are encrypted at rest</li>
      </ul>

      <h2>Authentication</h2>
      <ul>
        <li>OAuth 2.0 authentication via GitHub</li>
        <li>Session management with automatic timeout</li>
      </ul>

      <h2>AI Providers</h2>
      <p>
        We integrate with AI providers who maintain their own security standards. We recommend reviewing each provider's data handling policies.
      </p>

      <h2>Contact</h2>
      <p>
        For security questions or to report vulnerabilities, contact us at{' '}
        <a href="mailto:security@agent-relay.com">security@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default SecurityPage;
