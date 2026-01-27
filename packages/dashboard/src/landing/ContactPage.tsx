/**
 * Agent Relay Cloud - Contact Page
 */

import { StaticPage } from './StaticPage';

export function ContactPage() {
  return (
    <StaticPage
      title="Contact Us"
      subtitle="Have questions? We'd love to hear from you."
    >
      <h2>Get in Touch</h2>
      <p>
        Whether you have a question about features, pricing, need a demo, or anything else, our team is ready to answer all your questions.
      </p>

      <div className="value-card" style={{ marginTop: '32px', marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px' }}>Email</h3>
        <p style={{ marginBottom: '24px' }}>
          <a href="mailto:hello@agentrelay.dev" style={{ fontSize: '1.1em' }}>hello@agentrelay.dev</a>
        </p>

        <h3 style={{ marginBottom: '16px' }}>Twitter / X</h3>
        <p style={{ marginBottom: 0 }}>
          <a href="https://twitter.com/AgentRelayDev" target="_blank" rel="noopener noreferrer" style={{ fontSize: '1.1em' }}>@AgentRelayDev</a>
        </p>
      </div>

      <h2>Open Source</h2>
      <p>
        Agent Relay is open source. You can find us on GitHub at{' '}
        <a href="https://github.com/AgentWorkforce/relay" target="_blank" rel="noopener noreferrer">
          github.com/AgentWorkforce/relay
        </a>.
      </p>
    </StaticPage>
  );
}

export default ContactPage;
