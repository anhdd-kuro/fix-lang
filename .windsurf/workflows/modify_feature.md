---
description: Workflow when modifying existing features
---

# Workflow when modifying existing features

1. Research & Planning

- Read `plan.md`, relevant memories (especially project structure, settings management, IPC, and feature-specific memories), and any existing documentation for the feature being modified.
- Clearly define the scope of the modification and the specific requirements.
- Identify all affected areas of the codebase:
  - Main process: AI request handlers (`src/main/ai.request/`), IPC handlers (`src/main/ipc/features/`), window management (`src/main/partials/`).
  - Preload scripts: Feature-specific preload modules (`src/preload/features/`) and the main preload entry (`src/preload/index.ts`).
  - Renderer components: Specific window views (`src/renderer/MainWindow/`, `src/renderer/TrayWindow/`, etc.), shared UI components (`src/renderer/components/`), and potentially global styles (`src/renderer/main.css`).
  - Stores and state management: `src/stores/` (e.g., `apiStore.ts`, `keybindingStore.ts`, feature-specific settings stores if applicable).
  - Constants: `src/const.ts`.
  - Type definitions: `src/preload/preload-api.types.ts` and any feature-specific type files.
- Review existing implementations and patterns in similar features to maintain consistency.
- Check `electron.vite.config.ts` if new windows/pages are involved.

2. Data Layer Modify

- Stores (`src/stores/`):
  - Update store schemas if new settings or data fields are required.
  - Modify store methods (getters/setters) to accommodate changes.
  - Ensure type safety and provide default values for new settings. Refer to "Settings Management Best Practices" memory.
- AI Request Handlers (`src/main/ai.request/`):
  - Update request handlers to use new settings or process data differently.
  - Modify prompt templates (`src/prompts/`) if AI interaction changes.
  - Adjust logic for model selection, incorporating `modelId` as per "History entries now include a modelId field" memory.
- Constants (`src/const.ts`):
  - Add or update any relevant constants.

3. Communication Layer Modify

- IPC Handlers (`src/main/ipc/features/`):
  - Update IPC channel handlers to manage new data or logic.
  - Ensure request/response payloads are correctly typed.
- Preload Scripts (`src/preload/features/` and `src/preload/index.ts`):
  - Modify feature-specific preload modules to expose new/updated methods to the renderer.
  - Update `ElectronAPI` types in `src/preload/preload-api.types.ts`.
  - Ensure the main `src/preload/index.ts` correctly exposes the updated feature APIs using object spread syntax as per "Organizing preload scripts" memory.
  - If events are broadcasted, follow the "Centralized Event Broadcasting" patterns.

4. UI Layer Modify

- Renderer Components (`src/renderer/`):
  - Update relevant React components in specific windows (e.g., `MainWindow`, `SettingsPanels`) or shared components (`src/renderer/components/`).
  - Implement UI changes to reflect new settings, display new data, or provide new interactions.
  - Use existing shared components (e.g., `ModelSelect`) where possible.
  - Ensure UI elements are accessible (ARIA attributes, `alt` tags, etc.).
  - Update `main.css` or use Tailwind utilities if styling changes are needed.
  - Handle loading and error states gracefully in the UI.
- Vite Configuration (`electron.vite.config.ts`):
  - If a new UI page/window is added, update `renderer.build.rollupOptions.input` as per "Update electron.vite.config.ts" memory.

5. Documentation & Cleanup

- Update related documentation, JSDoc headers, and inline comments to reflect changes.
- Create new memories for significant patterns, architectural decisions, or complex logic implemented.
- Clean up any temporary code, `console.log` statements, or unused imports.
- Mark the relevant tasks/feature modifications as complete in `plan.md` or `plan.local-llm-todo.md`.

6. Quick Review & Refinement

- Check modified file sizes; split files if they exceed 200 lines.
- Identify and refactor any duplicated code by extracting shared logic into utility functions or common components.
- Review the component hierarchy and organization for clarity and maintainability.
- Ensure adherence to SOLID, DRY principles, and project-specific coding rules.
- Verify that all type definitions are consistent across layers.
- Manually test the modified feature thoroughly.