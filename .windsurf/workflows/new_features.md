---
description: Workflow when implement new feature
---

1. Research & Planning

- Read `plan.md`, memories, and related feature documentation.
- Define feature scope and requirements, then identify which areas of the codebase will be affected:
  - Main process
  - Preload scripts
  - Renderer components
  - Stores and state management
- Review existing implementations and patterns.
- Create an implementation plan `docs/plan.[featureName].md` with a step-by-step task breakdown in TODO list form.
- Prepare notes for the UI/UX flow in plan file.

2. Data Layer Setup

- Define types in `preload-api.types.ts`.
- Update store schemas in `stores/`.
- Create or update prompt templates in `prompts/`.
- Set up main process handlers in `main/ai.request/`.
- Mark the task as complete in the plan file.

3. Communication Layer

- Implement IPC handlers in `main/ipc/features/`.
- Add preload methods in `preload/features/`.
- Update `electron.vite.config.ts` if adding new windows.
- Set up event listeners and broadcasters.
- Mark the task as complete in the plan file.

4. UI Implementation

- Create or update components in `renderer/components/`.
- Implement feature-specific windows if needed.
- Connect the UI to preload methods.
- Add error handling and loading states.
- Ensure responsive design using Tailwind.
- Mark the task as complete in the plan file.

5. Documentation

- Update documentation and comments.
- Create new memories for patterns used.
- Clean up code and remove debug logs.
- Mark the feature as complete in plan file.

6. Quick review

- Check file sizes (split if necessary when files over 200 lines).
- Check for duplicated code and extract shared logic if found.
- Review component hierarchy and organization.