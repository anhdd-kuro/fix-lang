/**
 * @file heatmapIntensity.ts
 * @description Heatmap cell classes shaded from the theme primary (button) color.
 */
import { twJoin } from "tailwind-merge";

/** GitHub-style levels 0 (empty) through 4 (max intensity). */
const LEVEL_CLASSES = [
  "bg-secondary/50 ring-1 ring-inset ring-border/60",
  "bg-primary/20 ring-1 ring-inset ring-primary/30",
  "bg-primary/40 ring-1 ring-inset ring-primary/40",
  "bg-primary/65 ring-1 ring-inset ring-primary/50",
  "bg-primary ring-1 ring-inset ring-primary/60",
] as const;

/**
 * Returns Tailwind classes for a discrete heatmap intensity level (0–4).
 */
export const heatmapLevelClass = (level: number): string => {
  const index = Math.min(Math.max(level, 0), LEVEL_CLASSES.length - 1);
  return LEVEL_CLASSES[index] ?? LEVEL_CLASSES[0];
};

/**
 * Maps an activity ratio (0–1) to primary-shaded heatmap classes.
 */
export const heatmapRatioClass = (count: number, max: number): string => {
  if (count === 0 || max === 0) {
    return LEVEL_CLASSES[0];
  }

  const ratio = count / max;
  if (ratio >= 0.75) {
    return LEVEL_CLASSES[4];
  }
  if (ratio >= 0.5) {
    return LEVEL_CLASSES[3];
  }
  if (ratio >= 0.25) {
    return LEVEL_CLASSES[2];
  }
  return LEVEL_CLASSES[1];
};

/**
 * Base cell styling shared by heatmap squares.
 */
export const heatmapCellClass = (intensityClass: string): string =>
  twJoin("shrink-0 rounded-[3px]", intensityClass);
