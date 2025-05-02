import ollama from "ollama";
import type { ModelMetadata } from "../models/discover";
import type { Message, Options } from "ollama";

/**
 * Response structure for Ollama API operations
 */
type OllamaApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * Ollama client for interacting with local LLM models
 */
export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  /**
   * Makes a fetch request to the Ollama API with standardized error handling
   * @param endpoint - API endpoint (e.g., 'tags', 'pull', 'delete')
   * @param options - Fetch request options
   * @param timeout - Request timeout in milliseconds
   * @param operationName - Name of operation for logging
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    timeout = 2000,
    operationName = "Ollama operation"
  ): Promise<OllamaApiResponse<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Merge options with defaults
      const fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
      };

      // Make the request
      const response = await fetch(
        `${this.baseUrl}/api/${endpoint}`,
        fetchOptions
      );
      clearTimeout(timeoutId);

      // Handle non-OK responses
      if (!response.ok) {
        throw new Error(`Failed: ${response.status} ${response.statusText}`);
      }

      // Parse response data
      const data = await response.json();
      return { success: true, data };
    } catch (error: unknown) {
      // Handle specific error types
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`${operationName} timed out - is Ollama running?`);
      } else if (
        error instanceof Error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause &&
        error.cause.code === "ECONNREFUSED"
      ) {
        console.warn(
          `Connection to Ollama refused during ${operationName.toLowerCase()} - is Ollama running?`
        );
      } else {
        console.error(`Failed to ${operationName.toLowerCase()}:`, error);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Lists all available models from Ollama
   * @returns Array of model information
   */
  async listModels(): Promise<ModelMetadata[]> {
    const result = await this.makeRequest<{ models: ModelMetadata[] }>(
      "tags",
      {},
      2000,
      "List models"
    );

    if (result.success && result.data) {
      return result.data.models || [];
    }

    return [];
  }

  /**
   * Pulls (downloads) a model from Ollama
   * @param modelName - Name of the model to pull
   * @returns Result indicating success or failure
   */
  async pullModel(
    modelName: string
  ): Promise<{ success: boolean; error?: string }> {
    return await this.makeRequest(
      "pull",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      },
      10000, // Longer timeout for model downloads
      `Pull model ${modelName}`
    );
  }

  /**
   * Deletes a model from Ollama
   * @param modelName - Name of the model to delete
   * @returns Result indicating success or failure
   */
  async deleteModel(
    modelName: string
  ): Promise<{ success: boolean; error?: string }> {
    return await this.makeRequest(
      "delete",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      },
      2000,
      `Delete model ${modelName}`
    );
  }

  async chat({
    model,
    messages,
    options,
  }: {
    model: string;
    messages: Message[];
    options?: Partial<Options>;
  }) {
    try {
      const response = await ollama.chat({
        model,
        messages,
        options,
      });
      return response;
    } catch (error) {
      console.error("Chat error:", error);
      throw error;
    }
  }

  async generate({
    model,
    prompt,
    options,
  }: {
    model: string;
    prompt: string;
    options?: Partial<Options>;
  }) {
    try {
      const response = await ollama.generate({
        model,
        prompt,
        options,
      });
      return response;
    } catch (error) {
      console.error("Generation error:", error);
      throw error;
    }
  }
}
