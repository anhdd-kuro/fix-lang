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
- Create an implementation plan `docs/plan.[featureName].md` with a step-by-step.
- Prepare notes for the UI/UX flow in plan file.
- Use taskmaster-ai to analyze_project_complexity base on new plan file
- Use taskmaster-ai to generate tasks file

2. Implementation

- Use taskmaster-ai to get_tasks
- Start to implement
- Use taskmaster-ai to add_task or add_subtask if nessesary
- Use taskmaster-ai to set_task_status after the task done

3. Documentation

- Update documentation and comments.
- Create new memories for patterns used.
- Clean up code and remove debug logs.

4. Quick review

- Check file sizes (split if necessary when files over 200 lines).
- Check for duplicated code and extract shared logic if found.
- Review component hierarchy and organization.