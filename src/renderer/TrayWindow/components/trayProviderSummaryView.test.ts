/**
 * @file trayProviderSummaryView.test.ts
 * @description Pure selection coverage for the tray's Providers card.
 */
import { describe, expect, it } from "vitest";
import { selectProjectSpend } from "./trayProviderSummaryView";
import type { OpenAIProjectCosts } from "~/main/llm/providers/openai/usage.parsers";

const costs = (
  projects: OpenAIProjectCosts["projects"],
  totalUsd = 0,
): OpenAIProjectCosts => ({ totalUsd, projects });

describe("selectProjectSpend", () => {
  it("returns the configured project's own spend, not the range total", () => {
    const result = selectProjectSpend(
      costs(
        [
          { projectId: "proj_big", name: "Big", costUsd: 9 },
          { projectId: "proj_mine", name: "Mine", costUsd: 1.5 },
        ],
        10.5,
      ),
      "proj_mine",
    );

    expect(result).toEqual({ kind: "spend", costUsd: 1.5, name: "Mine" });
  });

  it("keeps a null name so the caller can fall back to the raw id", () => {
    const result = selectProjectSpend(
      costs([{ projectId: "proj_mine", name: null, costUsd: 2 }], 2),
      "proj_mine",
    );

    expect(result).toEqual({ kind: "spend", costUsd: 2, name: null });
  });

  it("reports no-spend rather than $0.00 for a project absent from the rows", () => {
    // `parseProjectCosts` drops zero-cost projects, so "absent" also covers
    // "unknown project" — claiming $0.00 would assert something /costs never said.
    expect(
      selectProjectSpend(
        costs([{ projectId: "proj_other", name: "Other", costUsd: 4 }], 4),
        "proj_mine",
      ),
    ).toEqual({ kind: "no-spend" });
    expect(selectProjectSpend(costs([]), "proj_mine")).toEqual({
      kind: "no-spend",
    });
  });

  it("never matches the unattributed bucket by accident", () => {
    // `parseProjectCosts` keys ungrouped spend as "". A configured id must not
    // pick that up, and an empty configured id never reaches here (sanitized).
    expect(
      selectProjectSpend(costs([{ projectId: "", name: null, costUsd: 7 }], 7), "proj_mine"),
    ).toEqual({ kind: "no-spend" });
  });
});
