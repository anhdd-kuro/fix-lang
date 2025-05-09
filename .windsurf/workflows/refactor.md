---
description: Refactor
---

# Review & Refactor

## Research

- Read `plan.md`, memories, and related feature documentation.
- Define feature scope and requirements, then identify which areas of the codebase will be affected:
  - Main process
  - Preload scripts
  - Renderer components
  - Stores and state management
- Review existing implementations and patterns.

## TODO

- Check file sizes (split if necessary when files over 200 lines).
- Check for duplicated code and extract shared logic if found.
- Run lint command to check, only fix files related to the request  
- Extract general shared logic into utility functions
- Review component hierarchy and organization
- Verify SOLID principles adherence
- Optimize imports and remove unused code
- Check for consistent naming conventions
- Ensure proper error handling coverage
- Review memory management (event listeners, cleanup)
- Validate accessibility implementation