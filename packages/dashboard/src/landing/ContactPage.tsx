/**
 * Agent Relay Cloud - Contact Page
 */

import React, { useState } from 'react';
import { StaticPage } from './StaticPage';

export function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: 'general',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real implementation, this would send to a backend
    console.log('Form submitted:', formData);
    setSubmitted(true);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <StaticPage
      title="Contact Us"
      subtitle="Have questions? We'd love to hear from you."
    >
      <h2>Get in Touch</h2>
      <p>
        Whether you have a question about features, pricing, need a demo, or anything else, our team is ready to answer all your questions.
      </p>

      {submitted ? (
        <div className="value-card" style={{ marginTop: '32px', textAlign: 'center' }}>
          <h4 style={{ marginBottom: '8px' }}>Message Sent!</h4>
          <p style={{ marginBottom: 0 }}>
            Thanks for reaching out. We'll get back to you within 24 hours.
          </p>
        </div>
      ) : (
        <form className="contact-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Your Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Jane Developer"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="jane@company.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="subject">Subject</label>
            <select
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleChange}
            >
              <option value="general">General Inquiry</option>
              <option value="sales">Sales & Pricing</option>
              <option value="support">Technical Support</option>
              <option value="partnership">Partnership Opportunity</option>
              <option value="enterprise">Enterprise Inquiry</option>
              <option value="press">Press & Media</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="message">Message</label>
            <textarea
              id="message"
              name="message"
              value={formData.message}
              onChange={handleChange}
              placeholder="Tell us how we can help..."
              required
            />
          </div>

          <button type="submit" className="btn-primary btn-large">
            Send Message
          </button>
        </form>
      )}

      <h2>Other Ways to Reach Us</h2>

      <h3>Email</h3>
      <ul>
        <li><strong>General:</strong> <a href="mailto:hello@agent-relay.com">hello@agent-relay.com</a></li>
        <li><strong>Sales:</strong> <a href="mailto:sales@agent-relay.com">sales@agent-relay.com</a></li>
        <li><strong>Support:</strong> <a href="mailto:support@agent-relay.com">support@agent-relay.com</a></li>
        <li><strong>Security:</strong> <a href="mailto:security@agent-relay.com">security@agent-relay.com</a></li>
      </ul>

      <h3>Social</h3>
      <ul>
        <li><a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter / X</a></li>
        <li><a href="https://github.com/AgentWorkforce/relay" target="_blank" rel="noopener noreferrer">GitHub</a></li>
        <li><a href="https://linkedin.com/company/agentrelay" target="_blank" rel="noopener noreferrer">LinkedIn</a></li>
      </ul>

      <h2>Office</h2>
      <p>
        Agent Relay, Inc.<br />
        548 Market Street, Suite 95879<br />
        San Francisco, CA 94104<br />
        United States
      </p>

      <h2>Enterprise Support</h2>
      <p>
        Enterprise customers have access to dedicated support channels including Slack Connect and priority email support. Contact your account manager or email <a href="mailto:enterprise@agent-relay.com">enterprise@agent-relay.com</a>.
      </p>
    </StaticPage>
  );
}

export default ContactPage;
