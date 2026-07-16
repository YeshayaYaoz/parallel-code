import type { ModelInfo } from '../registry.js';
import type { ProviderAdapter, ProviderResponse } from '../types.js';
import { openaiCompatibleAsk } from './base.js';

export const openaiAdapter: ProviderAdapter = {
  provider: 'openai',
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  ask(prompt: string, model: ModelInfo): Promise<ProviderResponse> {
    return openaiCompatibleAsk({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: model.id,
      prompt,
    });
  },
};
