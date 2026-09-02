/**
 * @file applyTypographyToDocument.test.ts
 * @description Applies typography CSS variables to the document root.
 */
import { describe, expect, it } from "vitest";
import { applyTypographyToDocument } from "./applyTypographyToDocument";

describe("applyTypographyToDocument", () => {
  it("sets css variables and data attributes on the document root", () => {
    applyTypographyToDocument({ fontSize: "lg", fontFamily: "mono" });

    expect(document.documentElement.style.getPropertyValue("--font-size-base")).toBe(
      "16px",
    );
    expect(
      document.documentElement.style.getPropertyValue("--font-family-ui"),
    ).toContain("monospace");
    expect(document.documentElement.dataset.fontSize).toBe("lg");
    expect(document.documentElement.dataset.fontFamily).toBe("mono");
    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("");
  });
});
