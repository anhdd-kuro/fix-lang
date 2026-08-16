/**
 * Ordering for FixLang's pre-release version grammar: exactly three numeric
 * components, a literal `-beta.` separator, and one numeric identifier
 * (`1.2.3-beta.4`). This parses untrusted GitHub release metadata, so the
 * grammar stays intentionally narrow — nothing past what beta builds emit.
 *
 * `updateService.ts` keeps its own private `StableVersion` (raw + the same
 * three numeric fields) and is out of scope here. The two interoperate by
 * shape, not by import: both satisfy `OrderableVersion` below, so a later
 * card can compare one of each without either module knowing about the
 * other's type.
 *
 * Despite the filename, `comparePrereleaseOrder` below is the repository's
 * only version comparator and is also used for plain stable-vs-stable
 * comparisons in `updateService.ts`. If you are about to compare two stable
 * versions elsewhere and searched for `compareVersion`/`compareStable` first,
 * this is that function — see the `compareVersionOrder` alias export at the
 * bottom of this file, and do not write a second/third comparator (a naive
 * string compare misorders `1.2.10` before `1.2.9`).
 */

export type OrderableVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
  /** Absent for a stable version; present for a pre-release identifier. */
  beta?: number;
}>;

export type PrereleaseVersion = Readonly<{
  raw: string;
  major: number;
  minor: number;
  patch: number;
  beta: number;
}>;

// Every component and the beta identifier reject leading zeros ("01"), and
// the separator is a literal lowercase "-beta." — no "-rc.", no "-beta" alone,
// no extra dotted identifiers, no "v" prefix, no uppercase "BETA".
const PRERELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

/**
 * Parses a strict `X.Y.Z-beta.N` string. Returns null for anything else,
 * including a bare `-beta` with no identifier, an `-rc.` suffix, a nested
 * identifier (`beta.1.2`), a `v` prefix, leading zeros in any position, or a
 * component past `Number.MAX_SAFE_INTEGER`.
 */
export const parsePrereleaseVersion = (
  value: unknown,
): PrereleaseVersion | null => {
  if (typeof value !== "string") return null;
  const match = PRERELEASE_VERSION_PATTERN.exec(value);
  if (!match) return null;

  const [major, minor, patch, beta] = match.slice(1).map(Number);
  if (![major, minor, patch, beta].every(Number.isSafeInteger)) return null;

  return Object.freeze({ raw: value, major, minor, patch, beta });
};

/**
 * Precedence across stable and pre-release versions of the same triple:
 * a stable version outranks any pre-release of it, and pre-releases of the
 * same triple order by their beta identifier numerically, not lexically
 * (`beta.10` outranks `beta.9`). The triple dominates both kinds of
 * comparison — `1.2.4-beta.1` outranks `1.2.3`.
 */
export const comparePrereleaseOrder = (
  left: OrderableVersion,
  right: OrderableVersion,
): number => {
  for (const part of ["major", "minor", "patch"] as const) {
    if (left[part] !== right[part]) return left[part] - right[part];
  }
  if (left.beta === undefined && right.beta === undefined) return 0;
  if (left.beta === undefined) return 1;
  if (right.beta === undefined) return -1;
  return left.beta - right.beta;
};

/**
 * Alias for {@link comparePrereleaseOrder} under a version-agnostic name, so a
 * grep for `compareVersion` finds the repo's one and only version comparator
 * instead of coming up empty. Use this (or `comparePrereleaseOrder` directly
 * — they are the same function) for stable-vs-stable comparisons too; do not
 * write a new comparator for that case.
 */
export const compareVersionOrder = comparePrereleaseOrder;
