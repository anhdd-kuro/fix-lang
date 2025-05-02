import { OllamaClient } from "../ollama/client";
import { getDeepSeekModel, isDeepSeekModel } from "../models/deepseek";
import { Message } from "ollama";
import { Options } from "ollama";

export class InferenceService {
  private client: OllamaClient;

  constructor(ollamaUrl?: string) {
    this.client = new OllamaClient(ollamaUrl);
  }

  async chat({
    messages,
    modelId,
    options,
  }: {
    messages: Message[];
    modelId: string;
    options?: Partial<Options>;
  }) {
    if (!isDeepSeekModel(modelId)) {
      throw new Error(`Unsupported model: ${modelId}`);
    }

    const model = getDeepSeekModel(modelId);
    if (!model.local?.path) {
      throw new Error(`Model ${modelId} is not configured for local inference`);
    }

    const defaultOptions = model.local.parameters || {};

    try {
      const response = await this.client.chat({
        model: model.local.path,
        messages,
        options: {
          ...defaultOptions,
          ...options,
        },
      });

      return response;
    } catch (error) {
      console.error("Inference error:", error);
      throw error;
    }
  }

  async generate({
    prompt,
    modelId,
    options,
  }: {
    prompt: string;
    modelId: string;
    options?: Partial<Options>;
  }) {
    if (!isDeepSeekModel(modelId)) {
      throw new Error(`Unsupported model: ${modelId}`);
    }

    const model = getDeepSeekModel(modelId);
    if (!model.local?.path) {
      throw new Error(`Model ${modelId} is not configured for local inference`);
    }

    const defaultOptions = model.local.parameters || {};

    try {
      const response = await this.client.generate({
        model: model.local.path,
        prompt,
        options: {
          ...defaultOptions,
          ...options,
        },
      });

      return response;
    } catch (error) {
      console.error("Generation error:", error);
      throw error;
    }
  }
}
