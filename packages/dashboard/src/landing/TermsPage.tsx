/**
 * Agent Relay Cloud - Terms of Service Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';

export function TermsPage() {
  return (
    <StaticPage
      title="Terms of Service"
      subtitle="The rules of the road for using Agent Relay."
      lastUpdated="January 15, 2026"
    >
      <h2>Agreement to Terms</h2>
      <p>
        By accessing or using Agent Relay ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, please do not use our Service.
      </p>

      <h2>Description of Service</h2>
      <p>
        Agent Relay is an AI agent orchestration platform that enables developers to deploy, coordinate, and monitor multiple AI agents working together on software development tasks. Our Service includes web-based dashboards, APIs, and integrations with AI providers and code repositories.
      </p>

      <h2>Account Registration</h2>
      <p>To use certain features of the Service, you must register for an account. You agree to:</p>
      <ul>
        <li>Provide accurate, current, and complete information</li>
        <li>Maintain and update your information as needed</li>
        <li>Keep your password secure and confidential</li>
        <li>Accept responsibility for all activities under your account</li>
        <li>Notify us immediately of any unauthorized use</li>
      </ul>

      <h2>Acceptable Use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Violate any applicable laws or regulations</li>
        <li>Generate malicious code, malware, or security exploits</li>
        <li>Harass, abuse, or harm others</li>
        <li>Infringe on intellectual property rights</li>
        <li>Attempt to gain unauthorized access to our systems</li>
        <li>Interfere with or disrupt the Service</li>
        <li>Reverse engineer or decompile the Service</li>
        <li>Use automated means to access the Service without permission</li>
        <li>Circumvent usage limits or billing controls</li>
      </ul>

      <h2>AI Provider Terms</h2>
      <p>
        Our Service integrates with third-party AI providers (Anthropic, OpenAI, Google). By using these integrations, you also agree to comply with their respective terms of service and usage policies. You are responsible for ensuring your use complies with all applicable AI provider terms.
      </p>

      <h2>Intellectual Property</h2>
      <h3>Your Content</h3>
      <p>
        You retain ownership of all code, data, and content you provide to the Service ("Your Content"). By using the Service, you grant us a limited license to process Your Content solely to provide the Service.
      </p>

      <h3>Our Property</h3>
      <p>
        The Service, including its design, features, and documentation, is owned by Agent Relay and protected by intellectual property laws. You may not copy, modify, or distribute our intellectual property without permission.
      </p>

      <h2>Payment Terms</h2>
      <p>
        Paid plans are billed in advance on a monthly or annual basis. All fees are non-refundable except as required by law or as explicitly stated otherwise. We may change pricing with 30 days' notice.
      </p>
      <ul>
        <li>Free tier usage is subject to specified limits</li>
        <li>Exceeding plan limits may result in service throttling or additional charges</li>
        <li>Failed payments may result in service suspension</li>
      </ul>

      <h2>Service Availability</h2>
      <p>
        We strive to maintain 99.9% uptime but do not guarantee uninterrupted access. We may perform maintenance or updates that temporarily affect availability. We are not liable for any damages resulting from service interruptions.
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, AGENT RELAY SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
      </p>
      <p>
        OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
      </p>

      <h2>Disclaimer of Warranties</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p>
        AI-generated outputs may contain errors. You are responsible for reviewing and validating all code and content produced by agents before use in production.
      </p>

      <h2>Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless Agent Relay from any claims, damages, or expenses arising from your use of the Service, your violation of these Terms, or your violation of any rights of a third party.
      </p>

      <h2>Termination</h2>
      <p>
        You may terminate your account at any time through your account settings. We may suspend or terminate your access for violation of these Terms or for any other reason with notice. Upon termination, your right to use the Service ceases immediately.
      </p>

      <h2>Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, without regard to conflict of law principles. Any disputes shall be resolved in the courts of Delaware.
      </p>

      <h2>Changes to Terms</h2>
      <p>
        We may modify these Terms at any time. Material changes will be notified via email or through the Service. Continued use after changes constitutes acceptance of the new Terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms? Contact us at{' '}
        <a href="mailto:legal@agent-relay.com">legal@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default TermsPage;
