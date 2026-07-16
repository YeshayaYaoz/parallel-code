import { describe, it, expect } from 'vitest';
import { getModelForMode, canUseModel, MODEL_REGISTRY } from './registry.js';

describe('getModelForMode', () => {
  it('returns cheapest model for cheap mode', () => {
    const model = getModelForMode('cheap');
    expect(model).not.toBeNull();
    expect(model?.id).toBe('gpt-4o-mini');
  });

  it('returns Sonnet for balanced mode', () => {
    const model = getModelForMode('balanced');
    expect(model).not.toBeNull();
    expect(model?.id).toContain('sonnet');
    expect(model?.provider).toBe('anthropic');
  });

  it('returns Opus for extra mode', () => {
    const model = getModelForMode('extra');
    expect(model).not.toBeNull();
    expect(model?.id).toContain('opus');
    expect(model?.provider).toBe('anthropic');
  });

  it('respects exclude list', () => {
    const model = getModelForMode('cheap', ['gpt-4o-mini']);
    expect(model).not.toBeNull();
    expect(model?.id).not.toBe('gpt-4o-mini');
  });

  it('returns null for empty registry after excluding all', () => {
    const allIds = Object.keys(MODEL_REGISTRY);
    const model = getModelForMode('cheap', allIds);
    expect(model).toBeNull();
  });

  it('returns null for unknown mode', () => {
    const model = getModelForMode('unknown' as never);
    expect(model).toBeNull();
  });
});

describe('canUseModel', () => {
  it('returns true for valid model with no reset', () => {
    expect(canUseModel('gpt-4o', {})).toBe(true);
  });

  it('returns false for unknown model', () => {
    expect(canUseModel('nonexistent-model', {})).toBe(false);
  });

  it('returns false when reset time is in the future', () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    expect(canUseModel('gpt-4o', { resetAt: futureDate })).toBe(false);
  });

  it('returns true when reset time is in the past', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    expect(canUseModel('gpt-4o', { resetAt: pastDate })).toBe(true);
  });

  it('returns true when resetAt is undefined', () => {
    expect(canUseModel('gpt-4o', { resetAt: undefined })).toBe(true);
  });
});

describe('MODEL_REGISTRY', () => {
  it('contains expected models', () => {
    const ids = Object.keys(MODEL_REGISTRY);
    expect(ids).toContain('claude-sonnet-4-20250514');
    expect(ids).toContain('claude-opus-4-20250514');
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('gpt-4o-mini');
    expect(ids).toContain('gemini-2.5-pro');
  });

  it('has valid cost values (positive numbers)', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.costPerMillionTokens).toBeGreaterThan(0);
    }
  });

  it('has positive maxTokens', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.maxTokens).toBeGreaterThan(0);
    }
  });

  it('has non-empty strengths arrays', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.strengths.length).toBeGreaterThan(0);
    }
  });
});
