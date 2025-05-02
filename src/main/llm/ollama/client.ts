import ollama, { Message } from "ollama";
import { Options } from "ollama";

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }
      const data = await response.json();
      return data.models;
    } catch (error) {
      console.error("Failed to list Ollama models:", error);
      throw error;
    }
  }

  async pullModel(modelName: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to pull model ${modelName}:`, error);
      throw error;
    }
  }

  async deleteModel(modelName: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error);
      throw error;
    }
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
