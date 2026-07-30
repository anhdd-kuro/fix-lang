/**
 * @file features.ts
 * @description Build-time feature tags.
 *
 * Features are OPT-IN: if the build command does not carry the feature tag, the
 * feature is excluded from the build (no renderer bundle emitted) and inert at
 * runtime (hotkeys/IPC/settings tab all skipped).
 *
 * This module must stay pure — it is imported by `electron.vite.config.ts`
 * (Node, before any Electron exists), by the main process, and by the renderer.
 * Never import `electron` (or anything Electron-only) here.
 */

/** Every feature that can be toggled at build time. */
export const FEATURE_IDS = ["promptGen"] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export type FeatureFlags = Record<FeatureId, boolean>;

/**
 * Feature id -> CLI/env tag. The CLI form is `--<tag>`, the env form is a bare
 * `<tag>` inside `FIXLANG_FEATURES`.
 */
export const FEATURE_TAGS: Readonly<Record<FeatureId, string>> = {
  promptGen: "promptgen",
};

/** Enables every feature when it appears in `FIXLANG_FEATURES`. */
export const FEATURE_ENV_ALL = "all";

/** Env var read by {@link parseFeatureFlags}. */
export const FEATURE_ENV_VAR = "FIXLANG_FEATURES";

const TAG_TO_ID: Readonly<Record<string, FeatureId>> = Object.freeze(
  Object.fromEntries(
    FEATURE_IDS.map((id) => [FEATURE_TAGS[id], id] as const),
  ) as Record<string, FeatureId>,
);

const TRUTHY_VALUES = new Set(["", "true", "1", "yes", "on"]);
const FALSY_VALUES = new Set(["false", "0", "no", "off"]);

const allDisabled = (): FeatureFlags =>
  Object.fromEntries(FEATURE_IDS.map((id) => [id, false])) as FeatureFlags;

/**
 * `--promptgen`, `--promptgen=true`, `--no-promptgen`, `--promptgen=false`.
 * Returns `null` when the argument is not a recognised feature tag so callers
 * can silently ignore unknown flags.
 */
const parseCliToken = (
  token: string,
): { id: FeatureId; enabled: boolean } | null => {
  if (!token.startsWith("--")) return null;

  const body = token.slice(2);
  const eq = body.indexOf("=");
  const rawName = (eq === -1 ? body : body.slice(0, eq)).toLowerCase();
  const rawValue = eq === -1 ? "" : body.slice(eq + 1).toLowerCase();

  const negated = rawName.startsWith("no-");
  const name = negated ? rawName.slice(3) : rawName;

  const id = TAG_TO_ID[name];
  if (!id) return null;

  let enabled: boolean;
  if (TRUTHY_VALUES.has(rawValue)) enabled = true;
  else if (FALSY_VALUES.has(rawValue)) enabled = false;
  // `--promptgen=whatever` is meaningless — ignore rather than throw.
  else return null;

  return { id, enabled: negated ? !enabled : enabled };
};

/**
 * Resolve build-time feature flags from CLI args and environment.
 *
 * Grammar:
 * - CLI: `--promptgen` / `--promptgen=true|1|yes|on` enable;
 *   `--no-promptgen` / `--promptgen=false|0|no|off` disable.
 * - Env: `FIXLANG_FEATURES=promptgen` (comma and/or whitespace separated);
 *   `FIXLANG_FEATURES=all` enables everything.
 * - Explicit CLI tags win over env.
 * - Every feature defaults to `false`. Unknown tags are ignored, never thrown.
 */
export const parseFeatureFlags = (input: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
}): FeatureFlags => {
  const flags = allDisabled();

  const envValue = input.env?.[FEATURE_ENV_VAR];
  if (envValue) {
    for (const rawTag of envValue.split(/[\s,]+/)) {
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;
      if (tag === FEATURE_ENV_ALL) {
        for (const id of FEATURE_IDS) flags[id] = true;
        continue;
      }
      const id = TAG_TO_ID[tag];
      if (id) flags[id] = true;
    }
  }

  // CLI second so explicit tags override whatever the env asked for.
  for (const token of input.argv ?? []) {
    const parsed = parseCliToken(token);
    if (parsed) flags[parsed.id] = parsed.enabled;
  }

  return flags;
};

/**
 * Runtime accessor for the PromptGen feature.
 *
 * `__FEATURE_PROMPT_GEN__` is injected by `electron.vite.config.ts` via
 * `define`. The `typeof` guard keeps this `false` under vitest, where no
 * bundler define exists.
 */
export const isPromptGenEnabled = (): boolean =>
  typeof __FEATURE_PROMPT_GEN__ !== "undefined" && __FEATURE_PROMPT_GEN__;
