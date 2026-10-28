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
import { AUTOCOMPLETE_RENDERER_SKIP_REASONS } from "./autocompleteDiagnostics";

/**
 * Any number primitive, NaN and ±Infinity included — exactly what
 * `typeof value === "number"` admits. Use `z.number()` where the guard also
 * demanded `Number.isFinite`.
 */
export const AnyNumberSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
]);

/**
 * An object shape that, like `typeof value === "object" && value !== null`,
 * also admits an ARRAY carrying the named fields, read through the array's
 * own enumerable keys. Unknown keys are kept, as the guard kept the object it
 * was handed.
 */
export const objectLike = <Fields extends Parameters<typeof z.looseObject>[0]>(
  fields: Fields,
) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? { ...value } : value),
    z.looseObject(fields),
  );

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
