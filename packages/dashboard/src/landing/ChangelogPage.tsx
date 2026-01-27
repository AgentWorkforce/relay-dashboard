/**
 * Agent Relay Cloud - Changelog Page
 *
 * Redirects to GitHub changelog
 */

import React, { useEffect } from 'react';
import { StaticPage } from './StaticPage';

const CHANGELOG_URL = 'https://github.com/AgentWorkforce/relay/blob/main/CHANGELOG.md';

export function ChangelogPage() {
  useEffect(() => {
    window.location.href = CHANGELOG_URL;
  }, []);

  return (
    <StaticPage
      title="Changelog"
      subtitle="Redirecting to GitHub..."
    >
      <p style={{ textAlign: 'center', marginTop: '32px' }}>
        You are being redirected to our changelog on GitHub.
      </p>
      <p style={{ textAlign: 'center' }}>
        If you are not redirected automatically, please click{' '}
        <a href={CHANGELOG_URL}>here</a>.
      </p>
    </StaticPage>
  );
}

export default ChangelogPage;
