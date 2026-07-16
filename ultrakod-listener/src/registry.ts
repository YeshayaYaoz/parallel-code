// Model registry — static model metadata for routing decisions.
//
// NOTE: this is a deliberate standalone copy of electron/ultrakod/registry.ts.
// This package deploys independently (e.g. to Railway, with its Root Directory
// set to ultrakod-listener/), so it can't depend on files outside its own
// directory without complicating that deploy. Keep the two in sync by hand
// when either changes — if they drift often enough to be annoying, that's the
// signal to move both into a shared npm workspace package instead.
//
// Pricing research notes (read before trusting these numbers blindly):
//   - Anthropic: cross-referenced against platform.claude.com pricing structure. High confidence.
//   - OpenAI, Google, DeepSeek, Mistral: their official pricing pages (openai.com/api/pricing,
//     ai.google.dev/gemini-api/docs/pricing) block automated fetches (403), so these numbers are
//     cross-referenced across multiple third-party pricing trackers instead of read directly from
//     the source. DeepSeek's numbers additionally matched a result that cited api-docs.deepseek.com
//     directly, so those are higher confidence than Google's.
//   - This is a fast-moving space — providers reprice and rename models every few months. Each
//     entry below carries `pricingAsOf` and `pricingConfidence` so it's obvious what to re-verify
//     and when. Re-run the research (or ask an agent to) every couple of months rather than trusting
//     this file indefinitely.
//   - DeepSeek is hosted and operated in China. Pricing/performance is legitimate and competitive,
//     but factor data-residency and jurisdiction into whether it's appropriate for a given task
//     before routing anything sensitive to it.

export type Provider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'mistral';

/** Editorial classification of where a model sits in its provider's lineup.
 *  Drives routing more than raw cost does, because "cheapest" and "best" aren't
 *  the same axis — see getModelForMode. */
export type ModelTier = 'budget' | 'balanced' | 'flagship';

/** Qualitative throughput/latency tier. Deliberately not a fabricated tokens/sec
 *  number — no verified cross-vendor benchmark backs a precise figure, and false
 *  precision is worse than an honest qualitative tier here. */
export type ThroughputTier = 'fast' | 'medium' | 'slow';

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  tier: ModelTier;
  /** USD per 1M input tokens. */
  inputCostPerMillion: number;
  /** USD per 1M output tokens (typically several times the input rate). */
  outputCostPerMillion: number;
  throughput: ThroughputTier;
  /** Total context window, in tokens. */
  contextWindowTokens: number;
  /** Practical max tokens the model will generate in one response. */
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  rateLimits: RateLimits;
  strengths: string[];
  /** ISO date this model's pricing was last verified. */
  pricingAsOf: string;
  pricingConfidence: 'high' | 'medium';
}

export interface ModelCapabilities {
  codeGeneration: boolean;
  codeReview: boolean;
  refactoring: boolean;
  debugging: boolean;
  documentation: boolean;
  longContext: boolean;
}

export interface RateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
  dailyQuota?: number;
  resetWindowHours: number;
}

export type RoutingMode = 'cheap' | 'balanced' | 'extra';

const fullCapabilities: ModelCapabilities = {
  codeGeneration: true,
  codeReview: true,
  refactoring: true,
  debugging: true,
  documentation: true,
  longContext: true,
};

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // --- Anthropic (high confidence) ---
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'budget',
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 5.0,
    throughput: 'fast',
    contextWindowTokens: 200_000,
    maxOutputTokens: 8192,
    capabilities: { ...fullCapabilities, longContext: true },
    rateLimits: { requestsPerMinute: 50, tokensPerMinute: 80_000, resetWindowHours: 5 },
    strengths: ['fast', 'cheap for a full-size model', 'good for routine edits'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'anthropic',
    tier: 'balanced',
    // Introductory pricing ($2/$10) runs through 2026-08-31, then reverts to $3/$15.
    inputCostPerMillion: 3.0,
    outputCostPerMillion: 15.0,
    throughput: 'medium',
    contextWindowTokens: 200_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 50, tokensPerMinute: 80_000, resetWindowHours: 5 },
    strengths: ['balanced performance', 'strong coding', 'good context window'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'anthropic',
    tier: 'flagship',
    inputCostPerMillion: 5.0,
    outputCostPerMillion: 25.0,
    throughput: 'slow',
    contextWindowTokens: 200_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 20, tokensPerMinute: 40_000, resetWindowHours: 5 },
    strengths: ['highest quality', 'complex reasoning', 'architecture'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },

  // --- OpenAI (gpt-4o family: high confidence; gpt-5.5: medium — fast-moving lineup) ---
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    tier: 'budget',
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    throughput: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 4096,
    capabilities: {
      ...fullCapabilities,
      codeReview: false,
      refactoring: false,
      longContext: false,
    },
    rateLimits: { requestsPerMinute: 200, tokensPerMinute: 200_000, resetWindowHours: 1 },
    strengths: ['cheapest OpenAI option', 'fastest', 'good for simple edits'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    tier: 'balanced',
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10.0,
    throughput: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 4096,
    capabilities: { ...fullCapabilities, longContext: false },
    rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100_000, resetWindowHours: 1 },
    strengths: ['fast', 'cost-effective', 'well-rounded'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },
  'gpt-5.5': {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    tier: 'flagship',
    inputCostPerMillion: 5.0,
    outputCostPerMillion: 30.0,
    throughput: 'slow',
    contextWindowTokens: 400_000,
    maxOutputTokens: 16_384,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 20, tokensPerMinute: 60_000, resetWindowHours: 1 },
    strengths: ['strong reasoning', 'large context window'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },

  // --- Google (medium confidence: official pricing page blocked automated fetch) ---
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'google',
    tier: 'budget',
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 3.0,
    throughput: 'fast',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 8192,
    capabilities: { ...fullCapabilities, codeReview: false },
    rateLimits: { requestsPerMinute: 30, tokensPerMinute: 60_000, resetWindowHours: 1 },
    strengths: ['cheap', 'huge context window', 'fast'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },
  'gemini-3.5-flash': {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'google',
    tier: 'balanced',
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 9.0,
    throughput: 'fast',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 30, tokensPerMinute: 60_000, resetWindowHours: 1 },
    strengths: [
      'large context',
      'multimodal',
      'good value',
      'beats Gemini 3.1 Pro on coding benchmarks',
    ],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    provider: 'google',
    tier: 'flagship',
    // Rises to $4/$18 above a 200K-token prompt.
    inputCostPerMillion: 2.0,
    outputCostPerMillion: 12.0,
    throughput: 'medium',
    contextWindowTokens: 2_000_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 20, tokensPerMinute: 40_000, resetWindowHours: 1 },
    strengths: ['largest context window available', 'multimodal', 'strong reasoning'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },

  // --- DeepSeek (high-ish confidence: one source cited api-docs.deepseek.com directly) ---
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    tier: 'budget',
    inputCostPerMillion: 0.14,
    outputCostPerMillion: 0.28,
    throughput: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100_000, resetWindowHours: 1 },
    strengths: [
      'by far the cheapest capable coding model here',
      'reasoning-capable despite the price',
      'China-hosted — mind data residency for sensitive tasks',
    ],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'high',
  },

  // --- Mistral (medium confidence) ---
  'mistral-small-3': {
    id: 'mistral-small-3',
    name: 'Mistral Small 3',
    provider: 'mistral',
    tier: 'budget',
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.3,
    throughput: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 8192,
    capabilities: { ...fullCapabilities, codeReview: false, longContext: false },
    rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100_000, resetWindowHours: 1 },
    strengths: ['very cheap', 'EU-hosted (GDPR-friendly)', 'fast'],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },
  'mistral-large-2': {
    id: 'mistral-large-2',
    name: 'Mistral Large 2',
    provider: 'mistral',
    tier: 'balanced',
    inputCostPerMillion: 2.0,
    outputCostPerMillion: 6.0,
    throughput: 'medium',
    contextWindowTokens: 128_000,
    maxOutputTokens: 8192,
    capabilities: fullCapabilities,
    rateLimits: { requestsPerMinute: 30, tokensPerMinute: 60_000, resetWindowHours: 1 },
    strengths: [
      'EU-hosted (GDPR-friendly)',
      'solid all-rounder',
      'cheaper than most flagship-tier models',
    ],
    pricingAsOf: '2026-07-16',
    pricingConfidence: 'medium',
  },
};

/** Typical agentic-coding workload skews input-heavy (file contents, tool output
 *  being read back in) far more than output-heavy. 3:1 is a reasonable fixed
 *  blend for ranking purposes — not a promise about any specific task's actual
 *  bill, just a consistent yardstick to sort models by. */
const INPUT_OUTPUT_BLEND_RATIO = 3;

export function effectiveCostPerMillion(model: ModelInfo): number {
  return (
    (model.inputCostPerMillion * INPUT_OUTPUT_BLEND_RATIO + model.outputCostPerMillion) /
    (INPUT_OUTPUT_BLEND_RATIO + 1)
  );
}

const THROUGHPUT_SCORE_MULTIPLIER: Record<ThroughputTier, number> = {
  fast: 1.15,
  medium: 1.0,
  slow: 0.85,
};

/** Lower is better. Cost adjusted so faster models score as an effective ~15%
 *  discount and slower models an effective ~15% penalty — used to break ties
 *  between similarly-priced or similarly-capable models. */
function routingScore(model: ModelInfo): number {
  return effectiveCostPerMillion(model) / THROUGHPUT_SCORE_MULTIPLIER[model.throughput];
}

function cheapestBy(models: ModelInfo[], score: (m: ModelInfo) => number): ModelInfo | null {
  return models.slice().sort((a, b) => score(a) - score(b))[0] ?? null;
}

/**
 * Picks a model for a routing mode. Every mode ranks candidates by the same
 * throughput-adjusted cost (routingScore) — modes differ in *which candidates
 * are eligible*, which is what actually changes the prioritization:
 *   - cheap:    every model is eligible — genuinely the cheapest option available.
 *   - balanced: only "balanced" tier models are eligible (each provider's
 *               well-rounded mid option), falling back to neighboring tiers if
 *               none remain after exclusions. Quality floor: mid-tier or better.
 *   - extra:    only "flagship" tier models are eligible first (falling back the
 *               same way) — quality is guaranteed by the tier restriction itself,
 *               so ranking the (already-best) flagship candidates by cost/throughput
 *               picks the best-value flagship model rather than an arbitrary one.
 */
export function getModelForMode(mode: RoutingMode, excludeModels: string[] = []): ModelInfo | null {
  const available = Object.values(MODEL_REGISTRY).filter((m) => !excludeModels.includes(m.id));
  if (available.length === 0) return null;

  const byTier = (tier: ModelTier) => available.filter((m) => m.tier === tier);

  switch (mode) {
    case 'cheap':
      return cheapestBy(available, routingScore);

    case 'balanced':
      return (
        cheapestBy(byTier('balanced'), routingScore) ??
        cheapestBy(byTier('flagship'), routingScore) ??
        cheapestBy(byTier('budget'), routingScore)
      );

    case 'extra':
      return (
        cheapestBy(byTier('flagship'), routingScore) ??
        cheapestBy(byTier('balanced'), routingScore) ??
        cheapestBy(byTier('budget'), routingScore)
      );

    default:
      return null;
  }
}

export function canUseModel(modelId: string, context: { resetAt?: string }): boolean {
  const model = MODEL_REGISTRY[modelId];
  if (!model) {
    return false;
  }

  if (context.resetAt) {
    const resetTime = new Date(context.resetAt);
    if (new Date() < resetTime) {
      return false;
    }
  }

  return true;
}
