/**
 * Pins how the usage store reads back whatever JSON is on disk — the file is
 * hand-editable, so the reader owns the shape. Covers the values JSON can
 * carry (including `1e400`, which `JSON.parse` turns into Infinity) at every
 * level: the `days` node, one day, and each counter. Written against the
 * `typeof` reader before it was replaced, so a parser swap that changes one
 * fallback fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { autocompleteUsageStore } from "./autocompleteUsageStore";

/** What electron-store persists: JSON. */
type StoredValue =
  | string
  | number
  | boolean
  | null
  | readonly StoredValue[]
  | { [key: string]: StoredValue };

const { storeData } = vi.hoisted(() => ({
  storeData: new Map<string, StoredValue>(),
}));

vi.mock("electron-store", () => {
  class MockStore {
    get(key: string, defaultValue?: StoredValue) {
      return storeData.has(key) ? storeData.get(key) : defaultValue;
    }
    set(key: string, value: StoredValue) {
      storeData.set(key, value);
    }
  }
  return { default: MockStore };
});

const DAY = "2026-07-31";
const NOW = new Date(2026, 6, 31, 12, 0);

const day = {
  date: DAY,
  requests: 3,
  responses: 3,
  tokenlessResponses: 1,
  unpricedResponses: 1,
  promptTokens: 40,
  completionTokens: 12,
  estimatedCostUsd: 0.02,
};

const COUNTERS = [
  "date",
  "requests",
  "responses",
  "tokenlessResponses",
  "unpricedResponses",
  "promptTokens",
  "completionTokens",
  "estimatedCostUsd",
] as const;

const VALUE_EDGES = [
  ["Infinity (1e400)", JSON.parse("1e400")],
  ["-Infinity", JSON.parse("-1e400")],
  ["-0", JSON.parse("-0")],
  ["fraction", 2.5],
  ["negative", -4],
  ["string", "3"],
  ["boolean", true],
  ["null", null],
  ["array", [3]],
  ["object", { n: 3 }],
] as const;

const readBack = () => ({
  day: autocompleteUsageStore.getDay(NOW),
  days: autocompleteUsageStore.getDays(),
});

describe("autocomplete usage store read-back equivalence", () => {
  beforeEach(() => {
    storeData.clear();
  });

  it.each(
    COUNTERS.flatMap((field) =>
      VALUE_EDGES.map(([label, value]) => [field, label, value] as const),
    ),
  )("%s = %s", (field, _label, value) => {
    storeData.set("days", { [DAY]: { ...day, [field]: value } });
    expect(readBack()).toMatchSnapshot("verdict");
  });

  it.each(COUNTERS)("%s missing", (field) => {
    const partial = Object.fromEntries(
      Object.entries(day).filter(([key]) => key !== field),
    );
    storeData.set("days", { [DAY]: partial });
    expect(readBack()).toMatchSnapshot("verdict");
  });

  it.each([
    ["valid", day],
    ["extra key", { ...day, extra: "x" }],
    ["legacy day without responses", { date: DAY, requests: 5 }],
    ["empty object", {}],
    ["null", null],
    ["string", "day"],
    ["number", 3],
    ["array", [day]],
  ] as const)("one day is %s", (_label, value) => {
    storeData.set("days", { [DAY]: value });
    expect(readBack()).toMatchSnapshot("verdict");
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["string", "days"],
    ["number", 3],
    ["boolean", false],
    ["empty array", []],
    ["array of days", [day, day]],
    ["empty object", {}],
  ] as const)("the days node is %s", (_label, value) => {
    if (value !== undefined) storeData.set("days", value);
    expect(readBack()).toMatchSnapshot("verdict");
  });
});
