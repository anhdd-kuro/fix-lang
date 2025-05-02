/**
 * @file discover.ts
 * @description Utilities for discovering and managing local LLM models
 */
import fs from "fs";
import path from "path";
import { InferenceService } from "../inference/service";
import { OllamaClient } from "../ollama/client";
import { DEEPSEEK_MODELS, DeepSeekModelId } from "./deepseek";
import { Model } from "~/stores/apiStore";

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
export interface ModelMetadata {
  name: string;
  size?: number;
  family?: string;
  quantization?: string;
  parameters?: Record<string, any>;
}

/**
 * The status of a model
 */
export type ModelStatus = "available" | "downloading" | "not-found";

/**
 * Get information about all locally available models
 */
export async function getLocalModels(): Promise<Model[]> {
  try {
    const ollamaClient = new OllamaClient();
    const ollamaModels = await ollamaClient.listModels();

    // Convert Ollama models to our Model type
    const models: Model[] = ollamaModels.map((ollamaModel: any) => {
      // Check if this is a DeepSeek model we know about
      const modelName = ollamaModel.name;
      if (modelName in DEEPSEEK_MODELS) {
        // Return our pre-configured DeepSeek model
        return DEEPSEEK_MODELS[modelName as DeepSeekModelId];
      }

      // For unknown models, create a basic Model entry
      return {
        id: ollamaModel.name,
        name: ollamaModel.name,
        created: Date.now(),
        source: "local",
        local: {
          path: ollamaModel.name,
          // Try to extract size from model name (e.g., llama2:7b -> 7)
          size: extractModelSize(ollamaModel.name),
          parameters: {
            temperature: 0.7,
            top_p: 0.95,
            repeat_penalty: 1.1,
          },
        },
      };
    });

    return models;
  } catch (error) {
    console.error("Failed to get local models:", error);
    // Return just our known DeepSeek models if Ollama API fails
    return Object.values(DEEPSEEK_MODELS);
  }
}

/**
 * Check status of a specific model
 */
export async function checkModelStatus(modelId: string): Promise<ModelStatus> {
  try {
    const ollamaClient = new OllamaClient();
    const models = await ollamaClient.listModels();

    // Check if model exists in Ollama
    const exists = models.some((model: any) => model.name === modelId);
    return exists ? "available" : "not-found";
  } catch (error) {
    console.error(`Failed to check status of model ${modelId}:`, error);
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
