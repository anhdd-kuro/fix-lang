/// <reference types="electron-vite/node" />
/// <reference types="node" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

/**
 * Build-time feature tag injected by `electron.vite.config.ts` (`define`).
 * Absent under vitest — always read it through `isPromptGenEnabled()` in
 * `src/features/core/shared/features.ts`, which guards with `typeof`.
 */
declare const __FEATURE_PROMPT_GEN__: boolean;
