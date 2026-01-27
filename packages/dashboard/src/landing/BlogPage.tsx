/**
 * Agent Relay Cloud - Blog Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function BlogPage() {
  return (
    <StaticPage
      title="Blog"
      subtitle="News, tutorials, and insights from the Agent Relay team."
    >
      <h2>Coming Soon</h2>
      <p>
        We're working on some great content to share with you. Check back soon for tutorials, product updates, and insights about multi-agent development.
      </p>

      <h2>Stay Updated</h2>
      <p>
        In the meantime, follow us on <a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter</a> for the latest updates.
      </p>
    </StaticPage>
  );
}

export default BlogPage;
