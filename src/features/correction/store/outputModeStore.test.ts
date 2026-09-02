import { describe, expect, it } from "vitest";
import { normalizeCorrectionOutputMode } from "~/features/correction/shared/outputMode";

describe("correction output mode", () => {
  it("defaults invalid persisted values to direct paste", () => {
    expect(normalizeCorrectionOutputMode(undefined)).toBe("paste");
    expect(normalizeCorrectionOutputMode("unexpected")).toBe("paste");
    expect(normalizeCorrectionOutputMode("popup")).toBe("popup");
  });
});
