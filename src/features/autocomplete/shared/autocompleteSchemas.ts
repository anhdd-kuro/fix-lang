/**
 * @file autocompleteSchemas.ts
 * @description Boundary schemas for autocomplete payloads crossing IPC and
 * read back from disk.
 *
 * Each schema reproduces the verdicts of the `typeof` guard it replaced, edge
 * inputs included — `boundaryEquivalence.test.ts` beside each consumer pins
 * them. Two defaults of the schema library differ from a `typeof` check and
 * are corrected here rather than at every call site: `z.number()` rejects NaN
 * and ±Infinity (see {@link AnyNumberSchema}), and `z.object()` rejects every
 * array (see {@link objectLike}).
 */
import { z } from "zod";
import {
  objectLike,
  AnyNumberSchema,
} from "~/features/core/shared/schemaGuard";
import { AUTOCOMPLETE_RENDERER_SKIP_REASONS } from "./autocompleteDiagnostics";

/**
 * Settings as they cross IPC in either direction. The cap must be FINITE:
 * `NaN` and `Infinity` both make the day's cap comparison silently
 * always-false, which is a budget that never fires.
 */
export const AutocompleteSettingsSchema = objectLike({
  enabled: z.boolean(),
  model: z.string(),
  dailyCostCapUsd: z.number(),
});

/** One of the closed set of reasons the renderer may report. */
export const AutocompleteRendererSkipReasonSchema = z.enum(
  AUTOCOMPLETE_RENDERER_SKIP_REASONS,
);
