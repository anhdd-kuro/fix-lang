# Implementation Plan: Adding DeepSeek-R1 as Local LLM

## Overview

This plan outlines the steps required to add DeepSeek-R1 as a local LLM option to the FixLang application, allowing users to minimize requests to paid OpenAI models. We'll integrate the local model while maintaining compatibility with the existing OpenAI implementation, providing a seamless experience for users.

## Prerequisites

- Ollama installed on the system (from ollama.com)
- DeepSeek-R1 model downloaded via Ollama
- Port 11434 available for Ollama API server
- Sufficient system resources (8GB+ RAM recommended)

## Phase 1: Infrastructure Setup

### 1.1 Add Local LLM Dependencies

```bash
# Install Ollama client and TypeScript
pnpm add typescript ollama
pnpm add -D @types/node

# Initialize TypeScript configuration
pnx tsc --init
```

### 1.2 Create Model Management Utilities

Create a new directory structure for local LLM management:

```plaintext
src/main/llm/
├── ollama/             # Ollama integration
│   ├── index.ts        # Main Ollama client setup
│   ├── client.ts       # Ollama API client wrapper
│   └── types.ts        # Type definitions for Ollama
├── models/             # Model management
│   ├── index.ts        # Model utilities
│   └── deepseek.ts     # DeepSeek model configuration
├── inference/          # Inference logic
│   ├── index.ts        # Main inference exports
│   └── service.ts      # Inference service implementation
└── index.ts           # Main entry point
```

## Phase 2: Core Implementation

### 2.1 Update Model Types

Modify `/src/main/ai.request/shared.ts` to include local model types:

```typescript
export type ModelSource = 'openai' | 'openrouter' | 'local';

export type Model = {
  id: string;
  name: string;
  created: number;
  source: ModelSource;
  local?: {
    path: string;
    parameters?: Record<string, any>;
    size?: number; // Model size in parameters (e.g., 7B, 13B)
  };
  pricing?: {
    // ... existing pricing fields
  };
};
```

### 2.2 Create Local LLM Inference Service

Implement Ollama-based inference service for DeepSeek-R1:

```typescript
// src/main/llm/inference/service.ts
import ollama from 'ollama';

export class OllamaInferenceService {
  private modelId: string;

  constructor(modelId: string = 'deepseek-coder:6.7b') {
    this.modelId = modelId;
  }

  async generateText(prompt: string, options?: OllamaOptions) {
    try {
      const response = await ollama.chat({
        model: this.modelId,
        messages: [{ role: 'user', content: prompt }],
        ...options
      });
      return response.message.content;
    } catch (error) {
      console.error('Ollama inference error:', error);
      throw error;
    }
  }

  async cleanup() {
    // Ollama handles cleanup automatically
    return true;
  }
}
```

### 2.3 Update AI Request Logic

Modify the `makeAIRequest` function in `src/main/ai.request/shared.ts` to handle local models:

```typescript
export const makeAIRequest = async (options: AIRequestOptions) => {
  // ... existing code for determining model

  const modelId = options.model || store.get("selectedModel");
  if (!modelId) {
    throw new Error("You have to select a model first.");
  }

  // Determine if the selected model is local or remote
  const models = store.get("models") || [];
  const selectedModel = models.find(m => m.id === modelId);
  const isLocalModel = selectedModel?.source === 'local';

  // Use appropriate implementation based on model source
  if (isLocalModel) {
    return makeLocalAIRequest(selectedModel, options);
  } else {
    // Existing OpenRouter/OpenAI implementation
    // ...
  }
};
```

### 2.4 Implement Ollama Model Management

Create utilities to manage Ollama models:

```typescript
// src/main/llm/ollama/client.ts
import ollama from 'ollama';

export class OllamaClient {
  async listModels() {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      const data = await response.json();
      return data.models;
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      throw error;
    }
  }

  async pullModel(modelName: string) {
    try {
      await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        body: JSON.stringify({ name: modelName })
      });
    } catch (error) {
      console.error(`Failed to pull model ${modelName}:`, error);
      throw error;
    }
  }

  async deleteModel(modelName: string) {
    try {
      await fetch('http://localhost:11434/api/delete', {
        method: 'DELETE',
        body: JSON.stringify({ name: modelName })
      });
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error);
      throw error;
    }
  }
}
```

### 2.5 Register Models in Store

Implement model registration in the electron store:

```typescript
// src/main/store/models.ts
export const registerOllamaModel = async (model: OllamaModel) => {
  const store = getStore();
  const models = store.get('models') || [];

  // Add or update model
  const existingIndex = models.findIndex(m => m.id === model.id);
  if (existingIndex >= 0) {
    models[existingIndex] = model;
  } else {
    models.push(model);
  }

  store.set('models', models);
};
```

## Phase 3: UI and Model Selection Integration

### 3.1 Update Model Type Definition

Ensure the `Model` type in `src/stores/apiStore.ts` includes local model information:

```typescript
export type Model = {
  id: string;
  name: string;
  created: number;
  source: 'openrouter' | 'openai' | 'local'; // Add source property
  pricing?: {
    prompt: string;
    completion: string;
    // other pricing fields...
  };
  local?: {
    path: string;
    size?: number;
    parameters?: {
      temperature?: number;
      top_p?: number;
      repeat_penalty?: number;
      [key: string]: unknown;
    };
  };
};
```

### 3.2 Integrate Local Models into Existing Model Flow

Modify the model fetching function to include local models:

```typescript
// src/main/ai.request/shared.ts
import { getLocalModels } from '../llm/models/discover';

export const fetchAvailableModels = async (apiKey: string): Promise<Model[]> => {
  try {
    // Fetch models from OpenRouter/OpenAI
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const remoteModels = (await response.json()).data as Model[];

    // Get local models from Ollama
    const localModels = await getLocalModels();

    // Combine and sort all models
    const allModels = [...remoteModels, ...localModels].sort((a, b) => {
      // Sort by source first (local models first, then remote)
      if (a.source === 'local' && b.source !== 'local') return -1;
      if (a.source !== 'local' && b.source === 'local') return 1;

      // Then by created date
      return b.created - a.created;
    });

    return allModels;
  } catch (error) {
    console.error('Error fetching models:', error);

    // If remote fetch fails, return only local models
    return await getLocalModels();
  }
};
```

### 3.3 Update Model Selection Component

Modify the existing model selection UI to show appropriate badges and info for local models:

```typescript
// src/renderer/components/ModelSelect.tsx
import { useState, useEffect } from 'react';
import { Model } from '~/stores/apiStore';

export const ModelSelect = () => {
  // Existing code...

  return (
    <div className="model-select">
      <h3>Select Model</h3>
      {loading ? (
        <p>Loading models...</p>
      ) : (
        <div>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            <option value="">Select a model</option>

            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.name}
                {model.source === 'local' && ` (${model.local?.size || '?'}B, Local)`}
              </option>
            ))}
          </select>

          {selectedModel && (
            <div className="model-info">
              {/* Show source badge */}
              {models.find(m => m.id === selectedModel)?.source === 'local' ? (
                <span className="badge local">Local</span>
              ) : (
                <span className="badge cloud">Cloud</span>
              )}

              {/* Other model details */}
            </div>
          )}

          {/* Add a button to manage local models if any local models exist */}
          {models.some(m => m.source === 'local') && (
            <button
              onClick={() => window.electronAPI.openModelManager()}
              className="manage-models-btn"
            >
              Manage Local Models
            </button>
          )}
        </div>
      )}
    </div>
  );
};
```

## Phase 4: Model Management and Downloads

### 4.1 Model Management UI

Create a UI for managing Ollama models:

```typescript
// src/renderer/components/ModelManager.tsx
import React, { useState, useEffect } from 'react';

export const ModelManager: React.FC = () => {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const models = await window.electronAPI.listOllamaModels();
      setModels(models);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePullModel = async () => {
    try {
      await window.electronAPI.pullOllamaModel('deepseek-coder:6.7b');
      await loadModels();
    } catch (error) {
      console.error('Failed to pull model:', error);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Local Models</h2>
      <button
        onClick={handlePullModel}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Pull DeepSeek Model
      </button>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <ul className="mt-4 space-y-2">
          {models.map(model => (
            <li key={model.name} className="flex items-center justify-between">
              <span>{model.name}</span>
              <button
                onClick={() => handleDeleteModel(model.name)}
                className="text-red-500"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

### 4.2 Model Hub Integration

Create a simple model hub interface:

1. List of recommended/tested models with metadata
2. Direct download links to verified sources
3. Local management UI (delete, update)

### 4.3 System Requirements Check

Implement a utility to check if the system has:

1. Sufficient RAM for the selected model
2. Compatible CPU/GPU for efficient inference
3. Enough disk space for model storage

## Phase 5: Feature Integration

### 5.1 Update Feature-Specific Logic

For each feature (correction, translation, summarization, promptGen):

1. Update the handlers to use local models when selected
2. Adjust prompts if necessary for DeepSeek-R1's context format
3. Implement fallback mechanisms if local inference fails

### 5.2 Performance Monitoring

Add performance tracking:

1. Record inference time for local models
2. Monitor memory usage during inference
3. Provide feedback to users about performance

### 5.3 Inference Queue

Implement a queue for local inference requests:

1. Create a priority queue for user requests
2. Manage concurrent requests to prevent memory issues
3. Provide status updates to the UI during processing

## Phase 6: Testing and Optimization

### 6.1 Testing Strategy

Develop test cases for:

1. Model loading and initialization
2. Text generation with various parameters
3. Error handling and recovery
4. Memory management and cleanup

### 6.2 Optimization

Profile and optimize for:

1. Initial load time of models
2. Inference speed for typical requests
3. Memory usage patterns
4. Battery impact on laptop users

## Phase 7: Documentation and User Guidance

### 7.1 User Documentation

Create documentation for:

1. Setting up local models (download, configuration)
2. Performance expectations and requirements
3. Troubleshooting common issues

### 7.2 Implementation Guide

Update developer documentation with:

1. Architecture overview of the local LLM integration
2. API changes and backward compatibility notes
3. Future extension points for other models

## Implementation Timeline

- Phase 1 (Infrastructure): 2-3 days
- Phase 2 (Core Implementation): 4-5 days
- Phase 3 (UI Integration): 2-3 days
- Phase 4 (Model Management): 3-4 days
- Phase 5 (Feature Integration): 2-3 days
- Phase 6 (Testing): 2-3 days
- Phase 7 (Documentation): 1-2 days

Total estimated time: 2-3 weeks of development work

## Technical Considerations

### Model Size and Performance

- DeepSeek-R1 7B is the most practical for desktop use
- 4-bit quantization recommended for RAM efficiency
- GPU acceleration strongly recommended for usable performance
- Consider dynamic context length based on available memory

### Security and Privacy

- Local models keep user data on-device
- No API keys required for basic functionality
- Implement model verification to prevent tampering
- Add privacy policy updates reflecting local processing

### Hybrid Approach

Consider implementing a hybrid approach where:

- Local models handle simple tasks (grammar fixes, short translations)
- Complex tasks with higher quality requirements use paid APIs
- User can configure which features use which models

## Conclusion

Adding DeepSeek-R1 as a local LLM option will significantly enhance the application by:

1. Reducing API costs for users
2. Providing offline functionality
3. Improving privacy by keeping data local
4. Serving as a foundation for future local AI capabilities

This implementation plan provides a structured approach to integrating DeepSeek-R1 while maintaining compatibility with existing OpenAI functionality, giving users the flexibility to choose the most appropriate model for their needs.
