import type { ModelInfo } from '../registry.js';
import type { ProviderAdapter, ProviderResponse } from '../types.js';
import { openaiCompatibleAsk } from './base.js';

// Registry id -> DeepSeek's actual API model slug. DeepSeek's own docs (the
// one high-confidence source in this research) state the "deepseek-reasoner"
// alias now routes to V4 Flash thinking mode, which is what our single
// registry entry represents.
const API_MODEL_ID: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-reasoner',
};

export const deepseekAdapter: ProviderAdapter = {
  provider: 'deepseek',
  isConfigured: () => Boolean(process.env.DEEPSEEK_API_KEY),
  ask(prompt: string, model: ModelInfo): Promise<ProviderResponse> {
    return openaiCompatibleAsk({
      baseUrl: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      model: API_MODEL_ID[model.id] ?? model.id,
      prompt,
    });
  },
};
