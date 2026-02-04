/**
 * Agent Relay Cloud - Static Page Layout
 *
 * Shared layout component for static content pages (About, Privacy, Terms, etc.)
 * Provides consistent navigation, footer, and content styling.
 */

import React from 'react';
import './styles.css';
import { LogoIcon } from '../components/Logo';

interface StaticPageProps {
  title: string;
  titleLink?: string;
  subtitle?: string;
  children: React.ReactNode;
  lastUpdated?: string;
}

export function StaticPage({ title, titleLink, subtitle, children, lastUpdated }: StaticPageProps) {
  return (
    <div className="landing-page static-page">
      <div className="landing-bg">
        <GridBackground />
        <GlowOrbs />
      </div>

      <StaticNavigation />

      <main>
        <section className="static-hero">
          <div className="static-hero-content">
            <h1>{titleLink ? <a href={titleLink} style={{ color: 'inherit', textDecoration: 'none' }}>{title}</a> : title}</h1>
            {subtitle && <p className="static-subtitle">{subtitle}</p>}
            {lastUpdated && <p className="static-updated">Last updated: {lastUpdated}</p>}
          </div>
        </section>

        <section className="static-content">
          <div className="content-container">
            {children}
          </div>
        </section>
      </main>

      <StaticFooter />
    </div>
  );
}

function StaticNavigation() {
  return (
    <nav className="nav scrolled">
      <div className="nav-inner">
        <a href="/" className="nav-logo">
          <LogoIcon size={28} withGlow={true} />
          <span className="logo-text">Agent Relay</span>
        </a>

        <div className="nav-links">
          <a href="/#demo">Demo</a>
          <a href="/#features">Features</a>
          <a href="/pricing">Pricing</a>
          <a href="https://docs.agent-relay.com/" className="nav-docs">Docs</a>
        </div>

        <div className="nav-actions">
          <a href="/login" className="btn-ghost">Sign In</a>
          <a href="/signup" className="btn-primary">Get Started</a>
        </div>
      </div>
    </nav>
  );
}

function StaticFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <a href="/" className="footer-logo">
            <LogoIcon size={24} withGlow={true} />
            <span className="logo-text">Agent Relay</span>
          </a>
          <p>Orchestrate AI agents like a symphony.</p>
        </div>

        <div className="footer-links">
          <div className="footer-column">
            <h4>Product</h4>
            <a href="/#features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="https://docs.agent-relay.com/">Documentation</a>
            <a href="/changelog">Changelog</a>
          </div>
          <div className="footer-column">
            <h4>Company</h4>
            <a href="/about">About</a>
            <a href="/blog">Blog</a>
            <a href="/careers">Careers</a>
            <a href="/contact">Contact</a>
          </div>
          <div className="footer-column">
            <h4>Legal</h4>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/security">Security</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; 2026 Agent Relay. All rights reserved.</p>
        <div className="social-links">
          <a href="https://github.com/AgentWorkforce/relay" aria-label="GitHub">
            <GitHubIcon />
          </a>
          <a href="https://twitter.com/agent_relay" aria-label="Twitter">
            <TwitterIcon />
          </a>
                  </div>
      </div>
    </footer>
  );
}

// Background components
function GridBackground() {
  return (
    <div className="grid-bg">
      <div className="grid-lines" />
      <div className="grid-glow" />
    </div>
  );
}

function GlowOrbs() {
  return (
    <div className="glow-orbs">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
    </div>
  );
}

// Icons
function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}


export default StaticPage;
