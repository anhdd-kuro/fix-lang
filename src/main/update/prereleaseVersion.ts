/**
 * Ordering for FixLang's pre-release version grammar: exactly three numeric
 * components, a literal `-beta.` separator, one numeric identifier
 * (`1.2.3-beta.4`). Parses untrusted GitHub release metadata, so the grammar
 * stays narrow — nothing past what beta builds emit.
 *
 * `comparePrereleaseOrder` is this repository's only version comparator and
 * serves stable-vs-stable comparisons too (aliased `compareVersionOrder` for
 * grep); do not add a second one.
 */

export type OrderableVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
  beta?: number;
}>;

export type PrereleaseVersion = Readonly<{
  raw: string;
  major: number;
  minor: number;
  patch: number;
  beta: number;
}>;

const PRERELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

/** Strict `X.Y.Z-beta.N`; null for anything else. */
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
 * Semver precedence: the triple dominates, and a stable version outranks any
 * pre-release of that same triple.
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

/** Version-agnostic alias for {@link comparePrereleaseOrder}. */
export const compareVersionOrder = comparePrereleaseOrder;
