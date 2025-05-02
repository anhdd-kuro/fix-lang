/**
 * @file recommended.ts
 * @description Curated list of recommended local LLM models for the app
 */

// Define the recommended model type
export type RecommendedModel = {
  name: string; // Model name (must match Ollama format)
  description: string; // User-friendly description
  size: number; // Size in bytes
  tags: string[]; // Features, capabilities, etc.
  requirements?: {
    minRam?: number; // Minimum RAM in bytes
    minDisk?: number; // Minimum disk space in bytes
    gpu?: boolean; // Whether GPU is recommended
  };
};

/**
 * Curated list of recommended models for the application
 * These models are chosen for their performance, size, and compatibility
 */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "deepseek-r1:7b",
    description:
      "DeepSeek-R1's versatile model with excellent reasoning and coding abilities",
    size: 7_500_000_000, // ~7.5GB
    tags: ["general-purpose", "medium-size", "high-quality", "reasoning"],
    requirements: {
      minRam: 8 * 1024 * 1024 * 1024, // 8 GB
      minDisk: 16 * 1024 * 1024 * 1024, // 16 GB
      gpu: false,
    },
  },
];

/**
 * Get the list of recommended models
 * @returns Array of recommended models
 */
export function getRecommendedModels(): RecommendedModel[] {
  return RECOMMENDED_MODELS;
}

/**
 * Find a specific recommended model by name
 * @param name Model name to find
 * @returns The model if found, undefined otherwise
 */
export function findRecommendedModel(
  name: string
): RecommendedModel | undefined {
  return RECOMMENDED_MODELS.find((model) => model.name === name);
}
