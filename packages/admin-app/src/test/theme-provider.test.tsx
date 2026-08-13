import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../theme/theme-provider';

let current: ReturnType<typeof useTheme>;

function ThemeProbe() {
  const theme = useTheme();
  useEffect(() => { current = theme; }, [theme]);
  return <><output>{theme.theme}</output><button onClick={theme.toggleTheme}>toggle</button></>;
}

function mockSystemTheme(isLight: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-color-scheme: light)' && isLight,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('uses a light system preference without persisting an initial override', () => {
    mockSystemTheme(true);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByText('light')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('ignores invalid stored content and follows the system preference', () => {
    localStorage.setItem('easypic-admin-theme', 'sepia');
    mockSystemTheme(false);
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('prefers an explicit stored dark choice over the light system preference', () => {
    localStorage.setItem('easypic-admin-theme', 'dark');
    mockSystemTheme(true);
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByText('dark')).toBeInTheDocument();
  });

  it('toggles the DOM theme and persists only the admin theme key', async () => {
    mockSystemTheme(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    await act(async () => { current.toggleTheme(); });

    expect(screen.getByText('light')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith('easypic-admin-theme', 'light');
  });
});
