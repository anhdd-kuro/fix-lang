/**
 * @file schemaGuard.ts
 * @description Turns zod schemas into the boundary checks the rest of the app
 * already speaks: type guards and exact-equivalent shape schemas.
 */
import { z } from "zod";

/**
 * A type guard backed by a schema, so the schema stays the one definition of
 * the shape while call sites keep reading as a predicate.
 *
 * Generic over the caller's input instead of taking `unknown`: the guard
 * narrows whatever the caller already holds to that type intersected with the
 * schema's output. Only `.success` is consulted, so the caller keeps its own
 * reference — never a stripped or re-keyed copy.
 */
export const schemaGuard =
  <Output>(schema: z.ZodType<Output>) =>
  <Input>(value: Input): value is Input & Output =>
    schema.safeParse(value).success;

/**
 * A total normalizer backed by a schema that never fails (every branch ends in
 * a `.catch`), generic over the caller's input for the same reason as
 * {@link schemaGuard}.
 */
export const schemaParser =
  <Output>(schema: z.ZodType<Output>) =>
  <Input>(value: Input): Output =>
    schema.parse(value);

/**
 * Accepts exactly what `typeof value === "object" && value !== null &&
 * !Array.isArray(value)` accepts — plain and null-prototype objects, but also
 * Date, Map, boxed primitives and class instances — and reads none of the
 * value's properties while deciding.
 */
export const NonArrayObjectSchema = z.object({});

/**
 * `Array.isArray(value) && value.every(item matches)`. Unlike `z.array`, a
 * hole in a sparse array is skipped rather than read as `undefined`, which is
 * what the hand-written guards this replaces did.
 */
export const everyItemSchema = <Item>(
  itemSchema: z.ZodType<Item>,
): z.ZodType<Item[]> =>
  z.custom<Item[]>(
    (value) =>
      Array.isArray(value) &&
      value.every((item) => itemSchema.safeParse(item).success),
  );

/**
 * Any JS number, including the `NaN` and `±Infinity` that `typeof value ===
 * "number"` accepts and `z.number()` rejects.
 */
export const AnyNumberSchema = z.union([
  z.number(),
  z.nan(),
  z.literal([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
]);

/**
 * An object schema that, like `typeof value === "object" && value !== null`,
 * also admits an ARRAY carrying the named fields, read through the array's
 * own enumerable keys. Unknown keys are kept (`looseObject`), as the guards
 * this replaces kept the value they were handed; inherited fields are read,
 * as a property access reads them.
 */
export const objectLike = <Fields extends Parameters<typeof z.looseObject>[0]>(
  fields: Fields,
) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? { ...value } : value),
    z.looseObject(fields),
  );
