import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markCoolingDown,
  clearCooldown,
  isAvailable,
  cooldownEndsAt,
  unavailableProviderIds,
  justRecovered,
} from './cooldowns.js';

describe('cooldowns', () => {
  beforeEach(() => {
    // Clear all state between tests by expiring anything left over.
    for (const p of ['anthropic', 'openai', 'google', 'deepseek', 'mistral'] as const) {
      clearCooldown(p);
    }
    vi.useRealTimers();
  });

  it('providers are available by default', () => {
    expect(isAvailable('anthropic')).toBe(true);
    expect(unavailableProviderIds()).toEqual([]);
  });

  it('marks a provider unavailable with an explicit reset time', () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    markCoolingDown('openai', resetAt);
    expect(isAvailable('openai')).toBe(false);
    expect(cooldownEndsAt('openai')).toBe(new Date(resetAt).getTime());
  });

  it('falls back to a default backoff when no reset time is given', () => {
    const before = Date.now();
    markCoolingDown('google');
    expect(isAvailable('google')).toBe(false);
    expect(cooldownEndsAt('google')).toBeGreaterThan(before);
  });

  it('falls back to the default backoff when the given reset time is unparseable', () => {
    markCoolingDown('mistral', 'not-a-date');
    expect(isAvailable('mistral')).toBe(false);
  });

  it('becomes available again once the reset time has passed', () => {
    markCoolingDown('deepseek', new Date(Date.now() - 1000).toISOString());
    expect(isAvailable('deepseek')).toBe(true);
  });

  it('clearCooldown makes a provider available immediately', () => {
    markCoolingDown('anthropic', new Date(Date.now() + 60_000).toISOString());
    expect(isAvailable('anthropic')).toBe(false);
    clearCooldown('anthropic');
    expect(isAvailable('anthropic')).toBe(true);
  });

  it('unavailableProviderIds lists only providers currently cooling down', () => {
    markCoolingDown('openai', new Date(Date.now() + 60_000).toISOString());
    markCoolingDown('mistral', new Date(Date.now() + 60_000).toISOString());
    expect(unavailableProviderIds().sort()).toEqual(['mistral', 'openai']);
  });

  it('justRecovered detects a provider that was unavailable and now is not', () => {
    markCoolingDown('openai', new Date(Date.now() + 60_000).toISOString());
    const previouslyUnavailable = new Set(unavailableProviderIds());
    clearCooldown('openai');
    expect(justRecovered(previouslyUnavailable)).toEqual(['openai']);
  });

  it('justRecovered returns nothing when nothing changed', () => {
    const previouslyUnavailable = new Set(unavailableProviderIds());
    expect(justRecovered(previouslyUnavailable)).toEqual([]);
  });
});
