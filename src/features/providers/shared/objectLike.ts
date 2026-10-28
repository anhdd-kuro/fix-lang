/**
 * @file objectLike.ts
 * @description A zod object schema that admits exactly what the hand-written
 * `typeof value === "object" && value !== null` guards it replaces admitted.
 *
 * Electron-free — shared by main, preload, and renderer.
 */
import { z } from "zod";

/** The field-schema map `z.object` accepts, named by its role here. */
type ObjectFields = NonNullable<Parameters<typeof z.object>[0]>;

/**
 * `z.object(fields)`, except that an array is also accepted and its own named
 * fields are read like an object's — `z.object` alone rejects arrays, which a
 * `typeof … === "object"` guard let through (IPC structured clone and in-process
 * callers can both hand over an array carrying named fields). Functions,
 * `null`, and primitives are still rejected; class instances, null-prototype
 * objects and inherited fields are read exactly as `z.object` reads them.
 */
export const objectLike = <Fields extends ObjectFields>(fields: Fields) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? { ...value } : value),
    z.object(fields),
  );

/** Matches `typeof value === "object" && value !== null`, fields unread. */
export const ObjectLikeSchema = objectLike({});
