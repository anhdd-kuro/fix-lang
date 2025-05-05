/**
 * @file discover.ts
 * @description Utilities for discovering and managing local LLM models
 */
import fs from "fs";
import path from "path";
import { ollamaClient } from "../ollama/client";
import type { Model } from "~/stores/apiStore";

/**
 * Format model size into a human-readable string (e.g., 7B, 13B)
 * @param sizeInParams Size in parameters, as a number
 * @returns Formatted size string
 */
function formatModelSize(sizeInParams?: number): string {
  if (!sizeInParams) return "Unknown";

  // Convert to billions and format
  const sizeInB = sizeInParams / 1_000_000_000;
  if (sizeInB >= 1) {
    return `${Math.round(sizeInB)}B`; // e.g., 7B, 13B
  } else {
    // For smaller models (millions)
    const sizeInM = sizeInParams / 1_000_000;
    return `${Math.round(sizeInM)}M`; // e.g., 125M, 350M
  }
}

/**
 * Default directories to scan for models
 */
const DEFAULT_MODEL_DIRECTORIES = [
  // Default Ollama model directory
  process.platform === "darwin" ? "/usr/local/share/ollama/models" : "",
  process.platform === "win32" ? "C:\\Program Files\\Ollama\\models" : "",
  process.platform === "linux" ? "/var/lib/ollama/models" : "",
].filter(Boolean);

/**
 * Metadata for a discovered model
 */
export type ModelMetadata = {
  name: string;
  size?: number;
  family?: string;
  quantization?: string;
  parameters?: Record<string, unknown> & { parameter_size?: number };
};

/**
 * The status of a model
 */
export type ModelStatus = "available" | "downloading" | "not-found";

/**
 * Estimate model context size based on parameter size or name
 * @param model Ollama model information
 * @returns Estimated context length
 */
function estimateContextLength(model: ModelMetadata): number {
  // If parameter size is available, use it to estimate context
  if (model.parameters?.parameter_size) {
    const paramSize = model.parameters?.parameter_size;
    if (paramSize >= 30_000_000_000) return 32768; // 30B+ models
    if (paramSize >= 10_000_000_000) return 16384; // 10B+ models
    if (paramSize >= 7_000_000_000) return 8192; // 7B+ models
    return 4096; // Default for smaller models
  }

  // Otherwise try to guess from the name
  const modelName = model.name.toLowerCase();
  if (modelName.includes("32k") || modelName.includes("32768")) return 32768;
  if (modelName.includes("16k") || modelName.includes("16384")) return 16384;
  if (modelName.includes("8k") || modelName.includes("8192")) return 8192;

  return 4096; // Default context window
}

/**
 * Generate a user-friendly description for a local model
 * @param model The Ollama model
 * @returns A formatted description string
 */
function generateModelDescription(model: ModelMetadata): string {
  const modelName = model.name.split(":")[0];
  const size = model.parameters?.parameter_size
    ? formatModelSize(model.parameters.parameter_size)
    : "Unknown size";
  const contextLength = estimateContextLength(model);

  return `${modelName} (Local, ${size}, ${contextLength} ctx)`;
}

/**
 * Fetch all local models from Ollama
 * @returns Array of local models formatted for display
 */
export async function getLocalModels(): Promise<Model[]> {
  try {
    console.log("[DEBUG] Starting local model discovery...");
    console.log("[DEBUG] Creating Ollama client instance...");

    console.log(
      "[DEBUG] Attempting to connect to Ollama at http://localhost:11434"
    );

    // Let's test the Ollama server separately first
    try {
      const listResponse = await ollamaClient.list();

      if (listResponse.models.length > 0) {
        console.log(
          "[DEBUG] Direct connection to Ollama successful",
          listResponse.models
            ? `Found ${listResponse.models.length} models directly`
            : "No models in direct response"
        );
        console.log(
          "[DEBUG] Raw Ollama response:",
          JSON.stringify(listResponse, null, 2)
        );
      } else {
        console.log(
          `[DEBUG] Direct connection to Ollama failed: ${listResponse}`
        );
      }
    } catch (directErr) {
      console.log(
        "[DEBUG] Direct connection to Ollama failed with error:",
        directErr
      );
    }

    console.log("[DEBUG] Now trying through the OllamaClient class...");
    const ollamaModels = await ollamaClient.list();
    console.log(
      "[DEBUG] OllamaClient.listModels() returned:",
      JSON.stringify(ollamaModels, null, 2)
    );

    if (!ollamaModels || ollamaModels.models.length === 0) {
      // If Ollama is not running or no models, return empty array
      console.log("No local models found or Ollama is not running");
      return [];
    }

    const localModels: Model[] = [];

    // Log the total number of models found in Ollama
    console.log(`Found ${ollamaModels.models.length} total Ollama models`);

    for (const model of ollamaModels.models) {
      // Model name format: owner/model:tag
      const modelName = model.name.split(":")[0]; // remove tag if present
      // Generate a consistent ID (replace all special chars with hyphens)
      const id = model.name;
      // Get context length for logging (not stored in model object)
      estimateContextLength(model);

      // Create a model object that exactly matches the Model type
      // Generate model description (for logging only, not stored in the model object)
      const description = generateModelDescription(model);
      console.debug(`Model description: ${description}`);

      const formattedModel: Model = {
        id,
        created: Date.now(),
        name: modelName,
        pricing: undefined, // Local models have no pricing
        local: {
          size: model.size || 0,
          path: model.name,
        },
      };

      localModels.push(formattedModel);
    }

    console.log(
      `Found ${localModels.length} supported local models`,
      localModels
    );
    return localModels;
  } catch (err) {
    console.error("Failed to get local models:", err);
    // Return empty array instead of throwing
    return [];
  }
}

/**
 * Check status of a specific model
 */
export async function checkModelStatus(modelId: string): Promise<ModelStatus> {
  try {
    const models = await ollamaClient.list();

    // Check if model exists in Ollama
    const exists = models.models.some(
      (model: ModelMetadata) => model.name === modelId
    );
    return exists ? "available" : "not-found";
  } catch (err) {
    console.error(`Failed to check status of model ${modelId}:`, err);
    return "not-found";
  }
}

/**
 * Extract model size from model name
 * Pattern examples: llama2:7b, llama2:13b, gpt4:8k
 */
function extractModelSize(modelName: string): number | undefined {
  try {
    // Try to match patterns like "7b", "13b", etc.
    const match = modelName.match(/:(\d+)(b|B)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return undefined;
  } catch (error) {
    console.error("Failed to extract model size:", error);
    return undefined;
  }
}

/**
 * Register a model with the application
 * This adds the model to the registry so it can be used by the application
 */
export function registerModel(model: Model): Model {
  // Implementation will be added in Phase 3 when we update settings schema
  return model;
}

/**
 * Scan local directories for model files
 * This is a fallback mechanism if Ollama API fails
 */
export async function scanForModelFiles(
  directories: string[] = DEFAULT_MODEL_DIRECTORIES
): Promise<string[]> {
  const modelFiles: string[] = [];

  for (const dir of directories) {
    try {
      if (!dir || !fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
          // Check if this looks like a model directory
          if (isModelDirectory(filePath)) {
            modelFiles.push(filePath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  return modelFiles;
}

/**
 * Check if a directory looks like a model directory
 */
function isModelDirectory(dirPath: string): boolean {
  try {
    // Simple heuristic: check for common model files
    const files = fs.readdirSync(dirPath);
    return files.some(
      (file) =>
        file.endsWith(".bin") ||
        file.endsWith(".gguf") ||
        file.endsWith(".safetensors") ||
        file.includes("config.json")
    );
  } catch (error) {
    console.error(`Error checking directory ${dirPath}:`, error);
    return false;
  }
}

/**
 * Extract metadata from a model
 */
export function extractModelMetadata(modelPath: string): ModelMetadata | null {
  try {
    // Basic model name from path
    const name = path.basename(modelPath);

    // Try to read metadata from a config file if one exists
    const configPath = path.join(modelPath, "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return {
        name,
        size: config.model_size || extractModelSize(name),
        family: config.model_family || undefined,
        quantization: config.quantization || undefined,
        parameters: config.parameters || undefined,
      };
    }

    // Return basic metadata if no config file
    return {
      name,
      size: extractModelSize(name),
    };
  } catch (error) {
    console.error(`Failed to extract metadata for ${modelPath}:`, error);
    return null;
  }
}
