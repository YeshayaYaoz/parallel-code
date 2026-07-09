import { describe, expect, it, vi } from 'vitest';
import {
  computeWrappedPathLinks,
  createTerminalHttpLinkHandler,
  matchTerminalPaths,
  normalizeHttpUrl,
  type TerminalBuffer,
  type TerminalBufferCell,
} from './terminalLinks';

/**
 * Build a fake xterm buffer from ASCII row specs. Each row is padded to `cols`
 * cells (width 1, matching real single-width chars); this exercises the same
 * cell-walking the real provider does without pulling in xterm.
 */
function makeBuffer(rows: { text: string; wrapped?: boolean }[], cols = 20): TerminalBuffer {
  const cell = (ch: string): TerminalBufferCell => ({
    getChars: () => ch,
    getWidth: () => 1,
  });
  const lines = rows.map((r) => ({
    length: cols,
    isWrapped: !!r.wrapped,
    translateToString: (trimRight?: boolean) =>
      trimRight ? r.text.replace(/\s+$/, '') : r.text.padEnd(cols, ' '),
    getCell: (x: number) => (x < cols ? cell(x < r.text.length ? r.text[x] : ' ') : undefined),
  }));
  return {
    getLine: (y: number) => (y >= 0 && y < lines.length ? lines[y] : undefined),
    getNullCell: () => cell(' '),
  };
}

function event(overrides: Partial<MouseEvent> = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

describe('normalizeHttpUrl', () => {
  it('accepts and normalizes web URLs', () => {
    expect(normalizeHttpUrl('HTTPS://EXAMPLE.COM/pr/1')).toBe('https://example.com/pr/1');
  });

  it('rejects invalid and non-web URLs', () => {
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHttpUrl('not a url')).toBeNull();
  });
});

describe('createTerminalHttpLinkHandler', () => {
  it('does nothing for unmodified desktop clicks when a modifier is required', () => {
    const openExternal = vi.fn();
    const e = event();
    const handler = createTerminalHttpLinkHandler({
      isMac: false,
      requireModifier: true,
      openExternal,
    });

    handler(e, 'https://example.com/');

    expect(openExternal).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('opens with Ctrl on non-mac platforms', () => {
    const openExternal = vi.fn();
    const e = event({ ctrlKey: true });
    const handler = createTerminalHttpLinkHandler({
      isMac: false,
      requireModifier: true,
      openExternal,
    });

    handler(e, 'HTTPS://EXAMPLE.COM/pr/1');

    expect(openExternal).toHaveBeenCalledWith('https://example.com/pr/1');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('opens with Cmd on macOS', () => {
    const openExternal = vi.fn();
    const e = event({ metaKey: true });
    const handler = createTerminalHttpLinkHandler({
      isMac: true,
      requireModifier: true,
      openExternal,
    });

    handler(e, 'https://example.com/');

    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('blocks invalid URLs after taking over the click', () => {
    const openExternal = vi.fn();
    const e = event({ ctrlKey: true });
    const handler = createTerminalHttpLinkHandler({
      isMac: false,
      requireModifier: true,
      openExternal,
    });

    handler(e, 'javascript:alert(1)');

    expect(openExternal).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('reports opener failures without throwing', async () => {
    const onOpenError = vi.fn();
    const handler = createTerminalHttpLinkHandler({
      isMac: false,
      openExternal: () => Promise.reject(new Error('failed')),
      onOpenError,
    });

    handler(event(), 'https://example.com/');
    await Promise.resolve();

    expect(onOpenError).toHaveBeenCalledTimes(1);
  });
});

describe('matchTerminalPaths', () => {
  it('matches absolute, relative, and bare paths with line:col suffixes', () => {
    expect(matchTerminalPaths('see /home/a/b.ts:42:10 now')).toEqual([
      { index: 4, text: '/home/a/b.ts:42:10' },
    ]);
    expect(matchTerminalPaths('open ./src/foo.tsx here')).toEqual([
      { index: 5, text: './src/foo.tsx' },
    ]);
    expect(matchTerminalPaths('edit src/store/tasks.ts')).toEqual([
      { index: 5, text: 'src/store/tasks.ts' },
    ]);
  });

  it('strips trailing punctuation and ignores dot-less directories', () => {
    expect(matchTerminalPaths('at (src/a.ts).')).toEqual([{ index: 4, text: 'src/a.ts' }]);
    expect(matchTerminalPaths('cd src/store/ then')).toEqual([]);
  });
});

describe('computeWrappedPathLinks', () => {
  it('links a path on a single unwrapped row', () => {
    const buffer = makeBuffer([{ text: '  src/a/b.ts' }]);
    const links = computeWrappedPathLinks(buffer, 0);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('src/a/b.ts');
    // 1-based, inclusive: starts at the 's' (col 3), ends at the last char.
    expect(links[0].range).toEqual({ start: { x: 3, y: 1 }, end: { x: 12, y: 1 } });
  });

  it('links a path that wraps across two rows as one multi-row range', () => {
    // "src/components/TerminalView.tsx" hard-wrapped at 20 cols.
    const buffer = makeBuffer(
      [{ text: 'src/components/Termi' }, { text: 'nalView.tsx', wrapped: true }],
      20,
    );
    // Hovering either the first or the wrapped continuation row yields the link.
    for (const row of [0, 1]) {
      const links = computeWrappedPathLinks(buffer, row);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe('src/components/TerminalView.tsx');
      expect(links[0].range.start).toEqual({ x: 1, y: 1 });
      expect(links[0].range.end.y).toBe(2);
      // Ends at the 11th char ("x") of the continuation row.
      expect(links[0].range.end.x).toBe(11);
    }
  });

  it('does not join across a non-wrapped boundary', () => {
    const buffer = makeBuffer([{ text: 'src/a.ts' }, { text: 'other/b.ts', wrapped: false }]);
    const links = computeWrappedPathLinks(buffer, 0);
    expect(links.map((l) => l.text)).toEqual(['src/a.ts']);
  });
});
