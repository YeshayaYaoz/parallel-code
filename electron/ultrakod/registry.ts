// Model registry - static model metadata for routing decisions.

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'local';
  costPerMillionTokens: number;
  maxTokens: number;
  capabilities: ModelCapabilities;
  rateLimits: RateLimits;
  strengths: string[];
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

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    costPerMillionTokens: 3.0,
    maxTokens: 8192,
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      refactoring: true,
      debugging: true,
      documentation: true,
      longContext: true,
    },
    rateLimits: {
      requestsPerMinute: 50,
      tokensPerMinute: 80000,
      resetWindowHours: 5,
    },
    strengths: ['balanced performance', 'strong coding', 'good context window'],
  },
  'claude-opus-4-20250514': {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    costPerMillionTokens: 15.0,
    maxTokens: 8192,
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      refactoring: true,
      debugging: true,
      documentation: true,
      longContext: true,
    },
    rateLimits: {
      requestsPerMinute: 20,
      tokensPerMinute: 40000,
      resetWindowHours: 5,
    },
    strengths: ['highest quality', 'complex reasoning', 'architecture'],
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    costPerMillionTokens: 2.5,
    maxTokens: 4096,
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      refactoring: true,
      debugging: true,
      documentation: true,
      longContext: false,
    },
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      resetWindowHours: 1,
    },
    strengths: ['fast', 'cost-effective', 'good for simple tasks'],
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    costPerMillionTokens: 0.15,
    maxTokens: 4096,
    capabilities: {
      codeGeneration: true,
      codeReview: false,
      refactoring: false,
      debugging: true,
      documentation: true,
      longContext: false,
    },
    rateLimits: {
      requestsPerMinute: 200,
      tokensPerMinute: 200000,
      resetWindowHours: 1,
    },
    strengths: ['cheapest', 'fastest', 'good for simple edits'],
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    costPerMillionTokens: 1.25,
    maxTokens: 8192,
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      refactoring: true,
      debugging: true,
      documentation: true,
      longContext: true,
    },
    rateLimits: {
      requestsPerMinute: 30,
      tokensPerMinute: 60000,
      resetWindowHours: 1,
    },
    strengths: ['large context', 'multimodal', 'good value'],
  },
};

export function getModelForMode(mode: RoutingMode, excludeModels: string[] = []): ModelInfo | null {
  const available = Object.values(MODEL_REGISTRY).filter((m) => !excludeModels.includes(m.id));

  switch (mode) {
    case 'cheap':
      return available.sort((a, b) => a.costPerMillionTokens - b.costPerMillionTokens)[0] ?? null;

    case 'balanced':
      return (
        available.filter((m) => m.provider === 'anthropic' && m.id.includes('sonnet'))[0] ??
        available.sort((a, b) => b.costPerMillionTokens - a.costPerMillionTokens)[0] ??
        null
      );

    case 'extra':
      return (
        available.filter((m) => m.provider === 'anthropic' && m.id.includes('opus'))[0] ??
        available.sort((a, b) => b.costPerMillionTokens - a.costPerMillionTokens)[0] ??
        null
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
