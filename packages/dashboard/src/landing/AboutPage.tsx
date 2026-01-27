/**
 * Agent Relay Cloud - About Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function AboutPage() {
  return (
    <StaticPage
      title="About Agent Relay"
      subtitle="Building the future of AI-powered software development."
    >
      <h2>Our Mission</h2>
      <p>
        We believe that AI agents working together can accomplish far more than any single agent or human developer alone. Agent Relay exists to make multi-agent orchestration accessible, reliable, and delightful for every developer and team.
      </p>

      <h2>The Problem We're Solving</h2>
      <p>
        AI coding assistants are transforming software development, but they work in isolation. Developers juggle multiple AI tools, copy-paste context between them, and manually coordinate their outputs. This fragmented workflow limits what AI can actually accomplish.
      </p>
      <p>
        Agent Relay changes that. We provide the infrastructure for AI agents to communicate, collaborate, and complete complex tasks together&mdash;like a well-coordinated development team that never sleeps.
      </p>

      <h2>The Team</h2>
      <p>
        Agent Relay was founded by two engineers passionate about developer tools and AI.
      </p>
      <div className="team-grid">
        <a href="https://github.com/khaliqgant" target="_blank" rel="noopener noreferrer" className="team-member">
          <div className="team-avatar">K</div>
          <h4>Khaliq Gant</h4>
          <p>Co-founder</p>
        </a>
        <a href="https://github.com/willwashburn" target="_blank" rel="noopener noreferrer" className="team-member">
          <div className="team-avatar">W</div>
          <h4>Will Washburn</h4>
          <p>Co-founder</p>
        </a>
      </div>

      <h2>Our Values</h2>
      <div className="values-grid">
        <div className="value-card">
          <h4>Developer-First</h4>
          <p>Every decision we make starts with: "Does this make developers' lives better?"</p>
        </div>
        <div className="value-card">
          <h4>Trust & Security</h4>
          <p>Your code is sacred. We treat security as a feature, not an afterthought.</p>
        </div>
        <div className="value-card">
          <h4>Open Ecosystem</h4>
          <p>We integrate with the tools you already use. No vendor lock-in, ever.</p>
        </div>
        <div className="value-card">
          <h4>Ship Fast, Learn Faster</h4>
          <p>We iterate quickly based on real feedback from real developers.</p>
        </div>
      </div>

      <h2>Get in Touch</h2>
      <p>
        Have questions or want to learn more? We'd love to hear from you.
      </p>
      <ul>
        <li>General inquiries: <a href="mailto:hello@agent-relay.com">hello@agent-relay.com</a></li>
        <li>Support: <a href="mailto:support@agent-relay.com">support@agent-relay.com</a></li>
        <li>Careers: <a href="mailto:hiring@agent-relay.com">hiring@agent-relay.com</a></li>
      </ul>
    </StaticPage>
  );
}

export default AboutPage;
