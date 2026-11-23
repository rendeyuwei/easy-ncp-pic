import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useTheme } from '../hooks/use-theme';

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme}>{theme}</button>;
}

describe('theme storage', () => {
  it('keeps switching when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<ThemeProbe />);

    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'light' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
