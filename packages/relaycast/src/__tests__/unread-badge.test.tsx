import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UnreadBadge from '@/components/UnreadBadge';

describe('UnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows count when under 100', () => {
    render(<UnreadBadge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ for counts over 99', () => {
    render(<UnreadBadge count={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});
