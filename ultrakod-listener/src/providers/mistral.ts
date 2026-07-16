import type { ModelInfo } from '../registry.js';
import type { ProviderAdapter, ProviderResponse } from '../types.js';
import { openaiCompatibleAsk } from './base.js';

// Registry id -> Mistral's actual API model slug. Mistral's official pricing
// page also blocked automated fetch during research, so these slugs follow
// their documented naming convention but aren't independently confirmed —
// verify against https://docs.mistral.ai/getting-started/models/ if either
// 404s, and fix the mapping here (not the registry id, which is just our
// internal display name).
const API_MODEL_ID: Record<string, string> = {
  'mistral-small-3': 'mistral-small-latest',
  'mistral-large-2': 'mistral-large-latest',
};

export const mistralAdapter: ProviderAdapter = {
  provider: 'mistral',
  isConfigured: () => Boolean(process.env.MISTRAL_API_KEY),
  ask(prompt: string, model: ModelInfo): Promise<ProviderResponse> {
    return openaiCompatibleAsk({
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: process.env.MISTRAL_API_KEY ?? '',
      model: API_MODEL_ID[model.id] ?? model.id,
      prompt,
    });
  },
};
