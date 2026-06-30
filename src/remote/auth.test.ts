import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConnectionString } from './auth';

interface StubLocation {
  origin: string;
  href: string;
}

let storage: Record<string, string>;
let location: StubLocation;

beforeEach(() => {
  storage = {};
  location = { origin: 'http://192.168.1.42:7777', href: 'http://192.168.1.42:7777/' };
  (globalThis as unknown as { window: unknown }).window = { location };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('applyConnectionString', () => {
  it('stores the token from a same-origin URL', () => {
    const result = applyConnectionString('http://192.168.1.42:7777/?token=abcd1234abcd1234');
    expect(result).toBe('stored');
    expect(storage['parallel-code-token']).toBe('abcd1234abcd1234');
  });

  it('navigates to a different-origin URL instead of storing in place', () => {
    const result = applyConnectionString('http://192.168.1.99:7777/?token=zzzz1234zzzz1234');
    expect(result).toBe('navigating');
    expect(location.href).toBe('http://192.168.1.99:7777/?token=zzzz1234zzzz1234');
    expect(storage['parallel-code-token']).toBeUndefined();
  });

  it('accepts a bare token', () => {
    const result = applyConnectionString('  AbC-123_def456ghi789  ');
    expect(result).toBe('stored');
    expect(storage['parallel-code-token']).toBe('AbC-123_def456ghi789');
  });

  it('rejects a URL with no token', () => {
    expect(applyConnectionString('http://192.168.1.42:7777/')).toBe('invalid');
  });

  it('rejects empty or non-token input', () => {
    expect(applyConnectionString('')).toBe('invalid');
    expect(applyConnectionString('   ')).toBe('invalid');
    expect(applyConnectionString('hello world')).toBe('invalid');
  });
});
