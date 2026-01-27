/**
 * Agent Relay Cloud - Security Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function SecurityPage() {
  return (
    <StaticPage
      title="Security"
      subtitle="Your code and data security is our top priority."
    >
      <h2>Our Security Commitment</h2>
      <p>
        At Agent Relay, we understand that you're trusting us with access to your code and development workflow. We've built our platform with security at its core, implementing industry-leading practices to protect your data.
      </p>

      <div className="security-badges">
                <div className="security-badge">
          <span className="security-badge-icon">🛡️</span>
          <span className="security-badge-text">GDPR Compliant</span>
        </div>
        <div className="security-badge">
          <span className="security-badge-icon">✓</span>
          <span className="security-badge-text">99.99% Uptime SLA</span>
        </div>
      </div>

      <h2>Infrastructure Security</h2>

      <h3>Hosting & Network</h3>
      <ul>
        <li>Hosted on AWS with multi-region redundancy</li>
        <li>Virtual Private Cloud (VPC) isolation for all services</li>
        <li>DDoS protection via AWS Shield and CloudFlare</li>
        <li>Web Application Firewall (WAF) with custom rule sets</li>
        <li>Regular infrastructure vulnerability scanning</li>
      </ul>

      <h3>Data Encryption</h3>
      <ul>
        <li><strong>At Rest:</strong> AES-256 encryption for all stored data</li>
        <li><strong>In Transit:</strong> TLS 1.3 for all network communications</li>
        <li><strong>Credentials:</strong> Zero-knowledge encryption for API keys and secrets</li>
        <li><strong>Backups:</strong> Encrypted and stored in separate geographic regions</li>
      </ul>

      <h2>Application Security</h2>

      <h3>Authentication & Access Control</h3>
      <ul>
        <li>OAuth 2.0 / OpenID Connect authentication</li>
        <li>Multi-factor authentication (MFA) support</li>
        <li>Role-based access control (RBAC) for team workspaces</li>
        <li>Session management with automatic timeout</li>
        <li>API key scoping with granular permissions</li>
      </ul>

      <h3>Code Security</h3>
      <ul>
        <li>Your source code is never stored permanently</li>
        <li>Code is processed in isolated, ephemeral containers</li>
        <li>Repository access tokens are scoped to minimum required permissions</li>
        <li>Agents run in sandboxed environments with no network access to your infrastructure</li>
      </ul>

      <h2>AI Provider Security</h2>
      <p>
        We integrate with leading AI providers who maintain their own rigorous security standards:
      </p>
      <ul>
        <li><strong>Anthropic (Claude):</strong> Your data is not used for model training</li>
        <li><strong>OpenAI (Codex):</strong> API data retention policies apply</li>
        <li><strong>Google (Gemini):</strong> Enterprise-grade data handling</li>
      </ul>
      <p>
        We recommend reviewing each provider's security documentation. Enterprise customers can configure data processing preferences and restrict which providers are used.
      </p>

      <h2>Operational Security</h2>

      <h3>Monitoring & Logging</h3>
      <ul>
        <li>24/7 automated security monitoring</li>
        <li>Anomaly detection for suspicious activities</li>
        <li>Comprehensive audit logs for all actions</li>
        <li>Real-time alerting for security events</li>
      </ul>

      <h3>Incident Response</h3>
      <ul>
        <li>Documented incident response procedures</li>
        <li>Security team on-call 24/7</li>
        <li>Maximum 1-hour response time for critical issues</li>
        <li>Transparent communication during incidents via status page</li>
      </ul>

      <h2>Security Testing</h2>
      <ul>
        <li>Regular penetration testing by third-party security firms</li>
        <li>Continuous automated security scanning</li>
        <li>Dependency vulnerability monitoring</li>
        <li>Annual security audits</li>
      </ul>

      <h2>Compliance</h2>
      <p>We maintain compliance with:</p>
      <ul>
                <li>GDPR (General Data Protection Regulation)</li>
        <li>CCPA (California Consumer Privacy Act)</li>
        <li>HIPAA (for Enterprise Healthcare customers)</li>
      </ul>

      <h2>Bug Bounty Program</h2>
      <p>
        We maintain an active bug bounty program to encourage responsible disclosure of security vulnerabilities. Rewards range from $100 to $10,000 depending on severity.
      </p>
      <p>
        Report vulnerabilities to <a href="mailto:security@agent-relay.com">security@agent-relay.com</a>.
      </p>

      <h2>Enterprise Security</h2>
      <p>Enterprise customers have access to additional security features:</p>
      <ul>
        <li>Single Sign-On (SSO) via SAML 2.0</li>
        <li>Dedicated VPC deployment option</li>
        <li>Custom data retention policies</li>
        <li>Audit log export and SIEM integration</li>
        <li>Security questionnaire and vendor assessment support</li>
      </ul>

      <h2>Contact Security Team</h2>
      <p>
        For security questions, vulnerability reports, or compliance documentation requests, contact us at{' '}
        <a href="mailto:security@agent-relay.com">security@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default SecurityPage;
