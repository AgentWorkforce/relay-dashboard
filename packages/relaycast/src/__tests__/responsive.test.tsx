import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResponsiveLayout from '@/components/ResponsiveLayout';

describe('ResponsiveLayout', () => {
  it('renders sidebar and main content on desktop', () => {
    // Default is desktop (window.innerWidth > 1024 in jsdom)
    render(
      <ResponsiveLayout sidebar={<nav>Sidebar</nav>}>
        <div>Main Content</div>
      </ResponsiveLayout>,
    );
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('renders optional panel', () => {
    render(
      <ResponsiveLayout
        sidebar={<nav>Sidebar</nav>}
        panel={<aside>Thread Panel</aside>}
      >
        <div>Main</div>
      </ResponsiveLayout>,
    );
    expect(screen.getByText('Thread Panel')).toBeInTheDocument();
  });
});
