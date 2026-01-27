/**
 * Agent Relay Cloud - Careers Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function CareersPage() {
  return (
    <StaticPage
      title="Careers"
      subtitle="Help us build the future of AI-powered development."
    >
      <h2>Join Us</h2>
      <p>
        We're building something that will fundamentally change how software gets built. AI agents working together as coordinated teams is the next evolution of developer tools, and we're at the forefront of making it happen.
      </p>

      <h2>Open Positions</h2>
      <p>
        We don't have any open positions at the moment, but we're always interested in meeting talented people who are passionate about developer tools and AI.
      </p>
      <p>
        If you think you'd be a great fit, send us an email at{' '}
        <a href="mailto:hiring@agent-relay.com">hiring@agent-relay.com</a> with a bit about yourself and what you're interested in working on.
      </p>

      <h2>What We Value</h2>
      <div className="values-grid">
        <div className="value-card">
          <h4>Curiosity</h4>
          <p>We love people who ask questions and dig deep to understand how things work.</p>
        </div>
        <div className="value-card">
          <h4>Ownership</h4>
          <p>Take initiative, see things through, and take pride in your work.</p>
        </div>
        <div className="value-card">
          <h4>Collaboration</h4>
          <p>Great products are built by teams that communicate well and support each other.</p>
        </div>
        <div className="value-card">
          <h4>Impact</h4>
          <p>We focus on work that moves the needle for developers using our platform.</p>
        </div>
      </div>

      <h2>Contact</h2>
      <p>
        Interested in joining us? Reach out at{' '}
        <a href="mailto:hiring@agent-relay.com">hiring@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default CareersPage;
