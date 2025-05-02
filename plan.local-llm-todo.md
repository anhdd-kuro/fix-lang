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

- [ ] Update model types:
  - [ ] Add `ModelSource` type to `shared.ts`
  - [ ] Extend `Model` type to include local model properties
  - [ ] Update existing model references to handle the new properties
- [ ] Implement Ollama inference service:
  - [ ] Create OllamaInferenceService class
  - [ ] Implement chat/completion methods using Ollama API
  - [ ] Add error handling and retries
  - [ ] Add temperature and other parameter controls
- [ ] Implement Ollama model management:
  - [ ] Create `src/main/llm/ollama/client.ts` with API methods
  - [ ] Implement listModels, pullModel, deleteModel functions
  - [ ] Add error handling and retries
- [ ] Create model discovery utilities:
  - [ ] Implement `src/main/llm/models/discover.ts`
  - [ ] Create functions to scan directories for model files
  - [ ] Add model metadata extraction functionality
- [ ] Update AI request logic:
  - [ ] Modify `makeAIRequest` in `shared.ts` to handle local models
  - [ ] Create `makeLocalAIRequest` function
  - [ ] Implement appropriate error handling and fallbacks

### Phase 3: UI and Settings Integration

- [ ] Update settings schema:
  - [ ] Add localLLM settings object to `SettingsStore` type
  - [ ] Update schema in `apiStore.ts`
  - [ ] Implement migration for existing users
- [ ] Create settings UI:
  - [ ] Create `src/renderer/components/SettingsLocalLLM.tsx`
  - [ ] Add model directory configuration UI
  - [ ] Add performance settings controls
  - [ ] Implement model selection UI
- [ ] Update model selection component:
  - [ ] Modify to display model source with icons
  - [ ] Show relevant stats for different model types
  - [ ] Add contextual settings based on model type
- [ ] Implement preload API:
  - [ ] Create `src/preload/features/localLLM.ts`
  - [ ] Implement required API methods
  - [ ] Update `src/preload/index.ts` to include new feature
- [ ] Add IPC handlers:
  - [ ] Create `src/main/ipc/features/localLLM.ts`
  - [ ] Implement handlers for local LLM operations
  - [ ] Register handlers in main process
  - [ ] Add to the registerIpcHandlers function in `src/main/index.ts`

### Phase 4: Model Management and Downloads

- [ ] Create model download utilities:
  - [ ] Create model management UI:
  - [ ] Create ModelManager component
  - [ ] Implement model listing and status display
  - [ ] Add pull/delete model functionality
  - [ ] Add loading states and error handling
- [ ] Create model hub UI:
  - [ ] Add recommended models list with metadata
  - [ ] Implement direct download functionality
  - [ ] Create model management UI (delete, verify)
- [ ] Implement system requirements checker:
  - [ ] Create utility to check RAM availability
  - [ ] Add GPU compatibility detection
  - [ ] Implement disk space verification
  - [ ] Add warning system for inadequate resources

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
