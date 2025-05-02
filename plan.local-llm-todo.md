# Local LLM Implementation Todo List

## Plan summary

This implementation adds DeepSeek-R1 as a local LLM to FixLang to minimize reliance on paid APIs. The plan is divided into 7 phases over 2-3 weeks:

1. **Infrastructure Setup** (2-3 days): Add dependencies and create directory structure for local LLM support
2. **Core Implementation** (4-5 days): Update model types, create inference service, and modify AI request logic
3. **UI and Settings Integration** (2-3 days): Add settings schema, create UI components, implement IPC handlers
4. **Model Management** (3-4 days): Create download utilities, model hub UI, and system requirement checker
5. **Feature Integration** (2-3 days): Update all features to use local models with appropriate fallbacks
6. **Testing and Optimization** (2-3 days): Test all components, optimize performance, and conduct end-to-end tests
7. **Documentation** (1-2 days): Create user guides and developer documentation

Key technical considerations include using 4-bit quantized models for efficiency, implementing a hybrid approach for optimal results, and ensuring proper error handling with fallbacks to cloud models when necessary.

## TODO

### Phase 1: Infrastructure Setup

- [x] Setup Ollama infrastructure:
  - [x] Install Ollama from ollama.com
  - [x] Install dependencies: `pnpm add typescript ollama @types/node`
  - [x] Initialize TypeScript: `npx tsc --init`
  - [x] Verify Ollama server runs on port 11434
- [x] Create directory structure for local LLM:
  - [x] Create `src/main/llm` directory
  - [x] Create `src/main/llm/ollama` subdirectory
  - [x] Create `src/main/llm/models` subdirectory
  - [x] Create `src/main/llm/inference` subdirectory
- [x] Implement type definitions and modules:
  - [x] Create `src/main/llm/ollama/types.ts` for Ollama types
  - [x] Create `src/main/llm/ollama/client.ts` for API wrapper
  - [x] Create `src/main/llm/models/deepseek.ts` for model config
  - [x] Create `src/main/llm/inference/service.ts` for inference
  - [x] Create index files for each directory

### Phase 2: Core Implementation

- [x] Update model types:
  - [x] Add `ModelSource` type to `shared.ts`
  - [x] Extend `Model` type to include local model properties
  - [x] Update existing model references to handle the new properties
- [x] Implement Ollama inference service:
  - [x] Create OllamaInferenceService class
  - [x] Implement chat/completion methods using Ollama API
  - [x] Add error handling and retries with backoff
  - [x] Add temperature and other parameter controls
  - [x] Implement metrics tracking for inference operations
  - [x] Add proper TypeScript types and streaming support
- [x] Implement Ollama model management:
  - [x] Create `src/main/llm/ollama/client.ts` with API methods
  - [x] Implement listModels, pullModel, deleteModel functions
  - [x] Add error handling and retries
- [x] Create model discovery utilities:
  - [x] Implement `src/main/llm/models/discover.ts`
  - [x] Create functions to scan directories for model files
  - [x] Add model metadata extraction functionality
- [x] Update AI request logic:
  - [x] Modify `makeAIRequest` in `shared.ts` to handle local models
  - [x] Create `makeLocalAIRequest` function
  - [x] Implement appropriate error handling and fallbacks

### Phase 3: UI and Model Selection Integration

- [ ] Update model selection component:
  - [ ] Modify existing model selector to display local models alongside OpenRouter models
  - [ ] Add visual indicators for local models (e.g., "Local" badge)
  - [ ] Show relevant stats for local models (e.g., size in parameters)
- [ ] Update models registration:
  - [ ] Add local models to the regular model list in `apiStore.ts`
  - [ ] Ensure model IDs for local models use a consistent prefix for identification
  - [ ] Allow local models to be selected like any other model
- [ ] Implement Ollama model discovery:
  - [ ] Add background process to detect installed Ollama models
  - [ ] Create utility to fetch and update available models list
  - [ ] Implement model list refreshing mechanism
- [ ] Update model fetching function:
  - [ ] Modify `fetchAvailableModels` to include local models
  - [ ] Integrate with Ollama model discovery
  - [ ] Sort and present models in a unified list
- [ ] Update UI indicators:
  - [ ] Show model source (local vs. cloud) in UI components
  - [ ] Add status indicators for model availability
  - [ ] Display appropriate error messages for unavailable models

### Phase 4: Model Management Integration

- [ ] Implement model management utilities:
  - [ ] Create a "Manage Local Models" option in the model dropdown
  - [ ] Implement Ollama model pull functionality
  - [ ] Add model deletion capability
  - [ ] Show download progress indicators
- [ ] Create recommended models list:
  - [ ] Add a curated list of recommended local models
  - [ ] Display model size, capabilities, and requirements
  - [ ] Implement one-click installation
- [ ] Add system compatibility checking:
  - [ ] Create utility to check system compatibility before model download
  - [ ] Display RAM and disk requirements
  - [ ] Show warnings for inadequate system resources
  - [ ] Provide recommendations for alternative models if needed
- [ ] Implement status monitoring:
  - [ ] Add real-time status monitoring for model downloads
  - [ ] Create error recovery mechanisms
  - [ ] Implement automatic model verification after download

### Phase 5: Feature Integration

- [ ] Update correction feature:
  - [ ] Modify handler to support local models
  - [ ] Adjust prompts for DeepSeek-R1 context format
  - [ ] Implement fallback mechanism
- [ ] Update translation feature:
  - [ ] Modify handler to support local models
  - [ ] Adjust prompts for DeepSeek-R1 context format
  - [ ] Implement fallback mechanism
- [ ] Update summarization feature:
  - [ ] Modify handler to support local models
  - [ ] Adjust prompts for DeepSeek-R1 context format
  - [ ] Implement fallback mechanism
- [ ] Update prompt generation feature:
  - [ ] Modify handler to support local models
  - [ ] Adjust prompts for DeepSeek-R1 context format
  - [ ] Implement fallback mechanism
- [ ] Create performance monitoring:
  - [ ] Add inference time tracking
  - [ ] Implement memory usage monitoring
  - [ ] Create UI for performance feedback
- [ ] Implement inference queue:
  - [ ] Create priority queue system
  - [ ] Add concurrent request management
  - [ ] Implement status updates for UI

### Phase 6: Testing and Optimization

- [ ] Create test suite:
  - [ ] Write tests for model loading
  - [ ] Test text generation with various params
  - [ ] Create error handling tests
  - [ ] Test memory management
- [ ] Perform optimization:
  - [ ] Profile and optimize model loading time
  - [ ] Improve inference speed
  - [ ] Optimize memory usage
  - [ ] Reduce battery impact for laptops
- [ ] Conduct end-to-end testing:
  - [ ] Test all features with local models
  - [ ] Test fallback scenarios
  - [ ] Verify cross-platform functionality

### Phase 7: Documentation and User Guidance

- [ ] Create user documentation:
  - [ ] Write setup guide for local models
  - [ ] Document performance expectations
  - [ ] Create troubleshooting guide
- [ ] Update developer documentation:
  - [ ] Document architecture overview
  - [ ] Provide API reference
  - [ ] Note backward compatibility details
  - [ ] Document extension points for future models
- [ ] Create in-app guidance:
  - [ ] Add tooltips for local model options
  - [ ] Create first-run guidance for local models
  - [ ] Add performance recommendations

### Final Steps

- [ ] Update readme and changelog
- [ ] Create release notes highlighting local LLM functionality
- [ ] Prepare demo for local LLM features
