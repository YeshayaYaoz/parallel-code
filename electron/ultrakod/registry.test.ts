import { describe, it, expect } from 'vitest';
import {
  getModelForMode,
  canUseModel,
  effectiveCostPerMillion,
  MODEL_REGISTRY,
} from './registry.js';

describe('effectiveCostPerMillion', () => {
  it('blends input and output cost, weighted toward input (3:1)', () => {
    const model = MODEL_REGISTRY['gpt-4o-mini'];
    // (0.15 * 3 + 0.6) / 4 = 0.2625
    expect(effectiveCostPerMillion(model)).toBeCloseTo(0.2625, 4);
  });
});

describe('getModelForMode', () => {
  it('returns the globally cheapest model for cheap mode', () => {
    // Mistral Small 3's cheaper input rate ($0.10 vs DeepSeek's $0.14) wins under
    // the 3:1 input-weighted blend even though its output rate is marginally
    // higher — verified against the actual routingScore, not assumed.
    const model = getModelForMode('cheap');
    expect(model).not.toBeNull();
    expect(model?.id).toBe('mistral-small-3');
  });

  it('returns a balanced-tier model for balanced mode', () => {
    const model = getModelForMode('balanced');
    expect(model).not.toBeNull();
    expect(model?.tier).toBe('balanced');
  });

  it('returns a flagship-tier model for extra mode', () => {
    const model = getModelForMode('extra');
    expect(model).not.toBeNull();
    expect(model?.tier).toBe('flagship');
  });

  it('falls back to the nearest tier when the target tier is fully excluded', () => {
    const balancedIds = Object.values(MODEL_REGISTRY)
      .filter((m) => m.tier === 'balanced')
      .map((m) => m.id);
    const model = getModelForMode('balanced', balancedIds);
    expect(model).not.toBeNull();
    expect(model?.tier).not.toBe('balanced');
  });

  it('respects the exclude list', () => {
    const model = getModelForMode('cheap', ['mistral-small-3']);
    expect(model).not.toBeNull();
    expect(model?.id).not.toBe('mistral-small-3');
  });

  it('returns null for an empty registry after excluding everything', () => {
    const allIds = Object.keys(MODEL_REGISTRY);
    const model = getModelForMode('cheap', allIds);
    expect(model).toBeNull();
  });

  it('returns null for an unknown mode', () => {
    const model = getModelForMode('unknown' as never);
    expect(model).toBeNull();
  });
});

describe('canUseModel', () => {
  it('returns true for a valid model with no reset', () => {
    expect(canUseModel('gpt-4o', {})).toBe(true);
  });

  it('returns false for an unknown model', () => {
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
  it('covers all five providers', () => {
    const providers = new Set(Object.values(MODEL_REGISTRY).map((m) => m.provider));
    expect(providers).toEqual(new Set(['anthropic', 'openai', 'google', 'deepseek', 'mistral']));
  });

  it('has at least one model per tier', () => {
    const tiers = new Set(Object.values(MODEL_REGISTRY).map((m) => m.tier));
    expect(tiers).toEqual(new Set(['budget', 'balanced', 'flagship']));
  });

  it('has positive cost values', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.inputCostPerMillion).toBeGreaterThan(0);
      expect(model.outputCostPerMillion).toBeGreaterThan(0);
    }
  });

  it('has output cost at or above input cost (holds for every provider researched)', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.outputCostPerMillion).toBeGreaterThanOrEqual(model.inputCostPerMillion);
    }
  });

  it('has positive context window and max output tokens', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.contextWindowTokens).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it('has non-empty strengths arrays', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.strengths.length).toBeGreaterThan(0);
    }
  });

  it('every model has a pricingAsOf date and confidence level', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['high', 'medium']).toContain(model.pricingConfidence);
    }
  });
});
