/**
 * @file provisioningKeyStore.test.ts
 * @description Unit tests for the PURE seams of the provisioning-key store.
 *
 * Per the #55 plan + security guidance, electron / `safeStorage` are NOT mocked
 * and the safeStorage+fs composition (set/get/clear/has) is NOT exercised here
 * (it needs an OS keychain + Electron runtime — covered by `bun run dev`/QA).
 * Importing the module would pull in `electron`, so we import ONLY the pure
 * helpers via Vitest's module interop without invoking the electron-touching
 * functions. The pure helpers carry the test coverage.
 */
import { describe, expect, it } from "vitest";
import {
  OPENROUTER_KEY_PREFIX,
  decodeCipherFromDisk,
  encodeCipherToDisk,
  isBlankStoredBlob,
  validateProvisioningKeyInput,
} from "./provisioningKeyStore";

describe("validateProvisioningKeyInput", () => {
  it("rejects an empty string", () => {
    const result = validateProvisioningKeyInput("");
    expect(result.ok).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    const result = validateProvisioningKeyInput("   ");
    expect(result.ok).toBe(false);
  });

  it("trims surrounding whitespace and accepts a prefixed key", () => {
    const result = validateProvisioningKeyInput("  sk-or-abc123  ");
    expect(result).toEqual({ ok: true, value: "sk-or-abc123" });
  });

  it("accepts a non-prefixed key with a soft warning (no hard block)", () => {
    const result = validateProvisioningKeyInput("randomkey");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("randomkey");
      expect(result.warning).toContain(OPENROUTER_KEY_PREFIX);
    }
  });

  it("accepts a prefixed key with no warning", () => {
    const result = validateProvisioningKeyInput("sk-or-v1-xyz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeUndefined();
    }
  });
});

describe("cipher encode/decode", () => {
  it("encodeCipherToDisk produces a base64 string", () => {
    const b64 = encodeCipherToDisk(Buffer.from("cipherbytes"));
    expect(b64).toBe(Buffer.from("cipherbytes").toString("base64"));
    expect(typeof b64).toBe("string");
  });

  it("decode(encode(buf)) round-trips to an equal Buffer", () => {
    const original = Buffer.from([0, 1, 2, 250, 251, 255]);
    const round = decodeCipherFromDisk(encodeCipherToDisk(original));
    expect(round.equals(original)).toBe(true);
  });

  it("decodeCipherFromDisk does not throw on malformed base64", () => {
    expect(() => decodeCipherFromDisk("not!!base64???")).not.toThrow();
  });
});

describe("isBlankStoredBlob", () => {
  it("treats empty content as unset", () => {
    expect(isBlankStoredBlob("")).toBe(true);
  });
  it("treats whitespace-only content as unset", () => {
    expect(isBlankStoredBlob("  \n\t ")).toBe(true);
  });
  it("treats non-blank content as set", () => {
    expect(isBlankStoredBlob("abc123==")).toBe(false);
  });
});
