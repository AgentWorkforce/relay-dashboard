/**
 * Agent Relay Cloud - Privacy Policy Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function PrivacyPage() {
  return (
    <StaticPage
      title="Privacy Policy"
      subtitle="We take your privacy seriously. Here's how we handle your data."
      lastUpdated="January 15, 2026"
    >
      <h2>Overview</h2>
      <p>
        Agent Relay ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI agent orchestration platform.
      </p>

      <h2>Information We Collect</h2>

      <h3>Account Information</h3>
      <p>
        When you create an account, we collect your name, email address, and authentication credentials. If you sign up using a third-party service (like GitHub), we receive basic profile information from that service.
      </p>

      <h3>Usage Data</h3>
      <p>
        We automatically collect information about how you interact with our platform, including:
      </p>
      <ul>
        <li>Agent sessions and message logs (stored encrypted)</li>
        <li>API requests and response metadata</li>
        <li>Feature usage patterns and preferences</li>
        <li>Browser type, device information, and IP address</li>
      </ul>

      <h3>Code and Repository Data</h3>
      <p>
        When you connect repositories to Agent Relay, we access only the files and metadata necessary to enable agent functionality. We do not store your source code permanently; it is processed in memory and cached temporarily for active sessions only.
      </p>

      <h2>How We Use Your Information</h2>
      <p>We use the collected information to:</p>
      <ul>
        <li>Provide, maintain, and improve our services</li>
        <li>Process transactions and send related information</li>
        <li>Send technical notices, updates, and support messages</li>
        <li>Respond to your comments, questions, and requests</li>
        <li>Monitor and analyze usage patterns to improve user experience</li>
        <li>Detect, prevent, and address technical issues and fraud</li>
      </ul>

      <h2>Data Sharing</h2>
      <p>We do not sell your personal information. We may share data with:</p>
      <ul>
        <li><strong>AI Provider Partners:</strong> Your prompts and context are sent to AI providers (Anthropic, OpenAI, Google) to enable agent functionality. These providers have their own privacy policies.</li>
        <li><strong>Service Providers:</strong> We use trusted third parties for hosting, analytics, and payment processing.</li>
        <li><strong>Legal Requirements:</strong> We may disclose information if required by law or to protect our rights.</li>
      </ul>

      <h2>Data Security</h2>
      <p>
        We implement industry-standard security measures including:
      </p>
      <ul>
        <li>AES-256 encryption for data at rest</li>
        <li>TLS 1.3 for data in transit</li>
        <li>Regular security audits and penetration testing</li>
                <li>Zero-knowledge credential storage</li>
      </ul>

      <h2>Data Retention</h2>
      <p>
        We retain your account data for as long as your account is active. Agent session logs are retained for 30 days by default (configurable in settings). You can request deletion of your data at any time.
      </p>

      <h2>Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access and export your personal data</li>
        <li>Correct inaccurate information</li>
        <li>Request deletion of your data</li>
        <li>Opt out of marketing communications</li>
        <li>Restrict processing of your data</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use essential cookies for authentication and session management. We also use analytics cookies (which you can opt out of) to understand how users interact with our platform.
      </p>

      <h2>International Transfers</h2>
      <p>
        Your data may be processed in the United States and other countries where our service providers operate. We ensure appropriate safeguards are in place for international data transfers.
      </p>

      <h2>Children's Privacy</h2>
      <p>
        Agent Relay is not intended for users under 18 years of age. We do not knowingly collect information from children.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this policy periodically. We will notify you of significant changes via email or through our platform.
      </p>

      <h2>Contact Us</h2>
      <p>
        For privacy-related questions or to exercise your rights, contact us at{' '}
        <a href="mailto:privacy@agent-relay.com">privacy@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default PrivacyPage;
