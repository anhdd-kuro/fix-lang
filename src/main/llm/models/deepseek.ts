import type { Model } from '../../ai.request/shared';

export const DEEPSEEK_MODELS = {
  'deepseek-coder:6.7b': {
    id: 'deepseek-coder-6.7b',
    name: 'DeepSeek Coder 6.7B',
    created: Date.now(),
    source: 'local' as const,
    local: {
      path: 'deepseek-coder:6.7b',
      size: 6.7,
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        repeat_penalty: 1.1,
      },
    },
  },
  'deepseek-coder:33b': {
    id: 'deepseek-coder-33b',
    name: 'DeepSeek Coder 33B',
    created: Date.now(),
    source: 'local' as const,
    local: {
      path: 'deepseek-coder:33b',
      size: 33,
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        repeat_penalty: 1.1,
      },
    },
  },
} as const;

export type DeepSeekModelId = keyof typeof DEEPSEEK_MODELS;

export function getDeepSeekModel(modelId: DeepSeekModelId): Model {
  const model = DEEPSEEK_MODELS[modelId];
  if (!model) {
    throw new Error(`Unknown DeepSeek model: ${modelId}`);
  }
  return model;
}

export function isDeepSeekModel(modelId: string): modelId is DeepSeekModelId {
  return modelId in DEEPSEEK_MODELS;
}
