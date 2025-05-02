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
    timeout = 5000,
    operationName = "Ollama operation"
  ): Promise<OllamaApiResponse<T>> {
    try {
      console.log(`[DEBUG] OllamaClient: Making request to ${this.baseUrl}/api/${endpoint} (${operationName})`);
      console.log(`[DEBUG] OllamaClient: Request options:`, JSON.stringify(options, null, 2));
      console.log(`[DEBUG] OllamaClient: Timeout set to ${timeout}ms`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`[DEBUG] OllamaClient: Request timed out after ${timeout}ms`);
        controller.abort();
      }, timeout);

      // Merge options with defaults
      const fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        // Ensure proper headers
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      };

      // Make the request
      console.log(`[DEBUG] OllamaClient: Sending fetch request to ${this.baseUrl}/api/${endpoint}`);
      const response = await fetch(
        `${this.baseUrl}/api/${endpoint}`,
        fetchOptions
      );
      clearTimeout(timeoutId);
      console.log(`[DEBUG] OllamaClient: Received response with status: ${response.status} ${response.statusText}`);

      // Handle non-ok responses
      if (!response.ok) {
        console.error(
          `[DEBUG] OllamaClient: ${operationName} failed with status: ${response.status} ${response.statusText}`
        );
        let errorText = "";
        try {
          // Try to get more error details from the response
          errorText = await response.text();
          console.log(`[DEBUG] OllamaClient: Error response body: ${errorText}`);
        } catch (textError) {
          console.log(`[DEBUG] OllamaClient: Could not read error response text: ${textError}`);
        }
        
        return {
          success: false,
          error: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
        };
      }

      // Parse JSON response
      console.log(`[DEBUG] OllamaClient: Parsing JSON response`);
      const data = await response.json();
      console.log(`[DEBUG] OllamaClient: Received data:`, JSON.stringify(data, null, 2));
      return { success: true, data: data as T };
    } catch (error) {
      // Handle fetch errors (network, timeout, etc.)
      console.error(`[DEBUG] OllamaClient: ${operationName} failed:`, error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error) || "Unknown error";

      console.log(`[DEBUG] OllamaClient: Error details: ${errorMessage}`);
      console.log(`[DEBUG] OllamaClient: Error stack:`, error instanceof Error ? error.stack : "No stack available");

      // Check if it's a network error
      if (errorMessage.includes("Failed to fetch") || errorMessage.includes("Network error")) {
        console.log(`[DEBUG] OllamaClient: This appears to be a network error. Checking if Ollama server is running...`);
        
        // Try a simple ping to check if server is up
        try {
          const pingResponse = await fetch(`${this.baseUrl}/api/version`, {
            method: "GET",
            signal: AbortSignal.timeout(1000),
          });
          console.log(`[DEBUG] OllamaClient: Server ping returned status ${pingResponse.status}`);
        } catch (pingError) {
          console.log(`[DEBUG] OllamaClient: Server ping failed, Ollama may not be running: ${pingError}`);
        }
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all available models in Ollama
   * @returns Promise resolving to array of model metadata
   */
  async listModels(): Promise<ModelMetadata[]> {
    console.log('[DEBUG] OllamaClient.listModels: Starting to fetch models from Ollama');
    try {
      // Use our utility with increased timeout
      const result = await this.makeRequest<{ models: ModelMetadata[] }>(
        "tags", 
        { 
          method: "GET",
          headers: { "Accept": "application/json" }
        },
        5000, // 5 second timeout
        "List models"
      );

      console.log('[DEBUG] OllamaClient.listModels: makeRequest returned:', JSON.stringify(result, null, 2));

      if (!result.success) {
        console.warn(`[DEBUG] OllamaClient.listModels: Failed to list Ollama models: ${result.error}`);
        return [];
      }

      if (!result.data?.models) {
        console.warn('[DEBUG] OllamaClient.listModels: Response successful but missing models array', result.data);
        return [];
      }

      console.log(`[DEBUG] OllamaClient.listModels: Successfully found ${result.data.models.length} models`);
      
      // Log each model for debugging
      result.data.models.forEach((model, index) => {
        console.log(`[DEBUG] OllamaClient.listModels: Model ${index + 1}: ${model.name}`);
      });

      return result.data.models;
    } catch (error) {
      console.error("[DEBUG] OllamaClient.listModels: Unexpected error:", error);
      return [];
    }
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
