import { describe, expect, it } from "vitest";
import {
  comparePrereleaseOrder,
  compareVersionOrder,
  parsePrereleaseVersion,
  type OrderableVersion,
} from "./prereleaseVersion";

const stable = (
  major: number,
  minor: number,
  patch: number,
): OrderableVersion => ({ major, minor, patch });

describe("parsePrereleaseVersion", () => {
  it("parses a well-formed beta version", () => {
    expect(parsePrereleaseVersion("1.2.3-beta.9")).toEqual({
      raw: "1.2.3-beta.9",
      major: 1,
      minor: 2,
      patch: 3,
      beta: 9,
    });
  });

  it("parses a beta identifier of zero (0 is a legal, non-falsy beta)", () => {
    expect(parsePrereleaseVersion("1.2.3-beta.0")).toEqual({
      raw: "1.2.3-beta.0",
      major: 1,
      minor: 2,
      patch: 3,
      beta: 0,
    });
  });

  it.each([
    "1.2.3-beta",
    "1.2.3-beta.01",
    "1.2.3-rc.1",
    "1.2.3-beta.1.2",
    "v1.2.3-beta.1",
    "01.2.3-beta.1",
    "1.2.3-BETA.1",
    "1.2.3-beta.9007199254740992",
  ])("rejects malformed input %s", (value) => {
    expect(parsePrereleaseVersion(value)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(parsePrereleaseVersion(undefined)).toBeNull();
    expect(parsePrereleaseVersion(null)).toBeNull();
    expect(parsePrereleaseVersion(123)).toBeNull();
  });
});

describe("comparePrereleaseOrder", () => {
  it("ranks a stable version above a pre-release of the same triple", () => {
    const betaVersion = parsePrereleaseVersion("1.2.3-beta.9");
    expect(betaVersion).not.toBeNull();
    expect(
      comparePrereleaseOrder(stable(1, 2, 3), betaVersion as OrderableVersion),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(betaVersion as OrderableVersion, stable(1, 2, 3)),
    ).toBeLessThan(0);
  });

  it("ranks a stable version above a beta.0 pre-release (beta: 0 is not undefined)", () => {
    const betaZero = parsePrereleaseVersion("1.2.3-beta.0");
    expect(betaZero).not.toBeNull();
    expect(
      comparePrereleaseOrder(stable(1, 2, 3), betaZero as OrderableVersion),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(betaZero as OrderableVersion, stable(1, 2, 3)),
    ).toBeLessThan(0);
  });

  it("orders same-triple pre-releases by beta identifier numerically, not lexically", () => {
    const beta9 = parsePrereleaseVersion("1.2.3-beta.9");
    const beta10 = parsePrereleaseVersion("1.2.3-beta.10");
    expect(beta9).not.toBeNull();
    expect(beta10).not.toBeNull();

    expect(
      comparePrereleaseOrder(
        beta10 as OrderableVersion,
        beta9 as OrderableVersion,
      ),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(
        beta9 as OrderableVersion,
        beta10 as OrderableVersion,
      ),
    ).toBeLessThan(0);
  });

  it("lets the triple dominate a same-triple beta-vs-stable comparison", () => {
    const nextTripleBeta = parsePrereleaseVersion("1.2.4-beta.1");
    expect(nextTripleBeta).not.toBeNull();

    expect(
      comparePrereleaseOrder(
        nextTripleBeta as OrderableVersion,
        stable(1, 2, 3),
      ),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(
        stable(1, 2, 3),
        nextTripleBeta as OrderableVersion,
      ),
    ).toBeLessThan(0);
  });

  it("orders the major component numerically, not lexically", () => {
    expect(
      comparePrereleaseOrder(stable(10, 0, 0), stable(9, 0, 0)),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(stable(9, 0, 0), stable(10, 0, 0)),
    ).toBeLessThan(0);
  });

  it("orders the minor component numerically, not lexically", () => {
    expect(
      comparePrereleaseOrder(stable(1, 10, 0), stable(1, 9, 0)),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(stable(1, 9, 0), stable(1, 10, 0)),
    ).toBeLessThan(0);
  });

  it("orders the patch component numerically, not lexically", () => {
    expect(
      comparePrereleaseOrder(stable(1, 0, 10), stable(1, 0, 9)),
    ).toBeGreaterThan(0);
    expect(
      comparePrereleaseOrder(stable(1, 0, 9), stable(1, 0, 10)),
    ).toBeLessThan(0);
  });

  it("treats two equal stable triples as equal", () => {
    expect(comparePrereleaseOrder(stable(1, 2, 3), stable(1, 2, 3))).toBe(0);
  });

  it("treats two equal pre-releases as equal", () => {
    const first = parsePrereleaseVersion("1.2.3-beta.9");
    const second = parsePrereleaseVersion("1.2.3-beta.9");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(
      comparePrereleaseOrder(
        first as OrderableVersion,
        second as OrderableVersion,
      ),
    ).toBe(0);
  });
});

describe("compareVersionOrder (alias)", () => {
  it("is the exact same function as comparePrereleaseOrder, discoverable under a version-agnostic name", () => {
    expect(compareVersionOrder).toBe(comparePrereleaseOrder);
  });

  it("orders two stable versions numerically, matching its documented stable-vs-stable use in updateService.ts", () => {
    expect(compareVersionOrder(stable(1, 2, 10), stable(1, 2, 9))).toBeGreaterThan(0);
    expect(compareVersionOrder(stable(1, 2, 9), stable(1, 2, 10))).toBeLessThan(0);
  });
});
