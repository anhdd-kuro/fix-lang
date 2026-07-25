import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
} from "~/shared/providers";
// Mocks must be hoisted above the module under test.
const { rmMock, readFileMock, getCurrentProfileIdMock } = vi.hoisted(() => ({
  rmMock: vi.fn(),
  readFileMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn(),
}));
vi.mock("node:fs/promises", () => {
  const api = {
    rm: rmMock,
    readFile: readFileMock,
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
  // Some transitive importer pulls this module's default export; without it
  // vitest fails the whole file before a single test runs.
  return { ...api, default: api };
});
vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/userData") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));
vi.mock("~/stores/apiStore", () => ({
  getCurrentProfileId: getCurrentProfileIdMock,
}));
import {
  clearProfileSecrets,
  getActiveProfileSecret,
  getProfileSecretPath,
  secretKindsForProvider,
  type SecretKind,
} from "./profileSecretStore";

beforeEach(() => {
  vi.clearAllMocks();
  rmMock.mockResolvedValue(undefined);
  readFileMock.mockResolvedValue(Buffer.from("a-secret").toString("base64"));
  getCurrentProfileIdMock.mockReturnValue("profile_1");
});

describe("profile secret targets", () => {
  it("rejects profile ids that could escape userData", () => {
    expect(() => getProfileSecretPath("../other", "openai", "api")).toThrow(
      "Invalid profile id",
    );
  });

  it("rejects credentials that a provider does not support", () => {
    expect(() => getProfileSecretPath("profile_1", "ollama", "api")).toThrow(
      "Ollama does not use an API key",
    );
    expect(() =>
      getProfileSecretPath("profile_1", "openai", "provisioning"),
    ).toThrow("Only OpenRouter has a provisioning key");
  });
});

// ---------------------------------------------------------------------------
// Slot derivation
//
// The point of these tests is that adding a fourth provider to `PROVIDER_IDS`
// needs NO edit in this file. So every expectation is computed from the
// provider tables, never from a literal list of three — a literal list would
// pass just as happily against the hand-written branches it replaced.
// ---------------------------------------------------------------------------

describe("secretKindsForProvider — derived from the provider tables", () => {
  it.each([...PROVIDER_IDS])("matches the tables for %s", (provider) => {
    const expected: SecretKind[] = [];
    if (PROVIDER_REQUIRES_API_KEY[provider]) expected.push("api");
    if (PROVIDER_SUPPORTS_PROVISIONING_KEY[provider]) expected.push("provisioning");

    expect(secretKindsForProvider(provider)).toEqual(expected);
  });

  it("gives a keyless provider no slots at all", () => {
    expect(secretKindsForProvider("ollama")).toEqual([]);
  });

  it("accepts exactly the pairs getProfileSecretPath accepts", () => {
    // The derivation and the guard must not be able to disagree: anything the
    // slot list offers must be constructible, and anything it withholds must
    // throw.
    for (const provider of PROVIDER_IDS) {
      const kinds = secretKindsForProvider(provider);
      for (const kind of ["api", "provisioning"] as const) {
        if (kinds.includes(kind)) {
          expect(() => getProfileSecretPath("profile_1", provider, kind)).not.toThrow();
        } else {
          expect(() => getProfileSecretPath("profile_1", provider, kind)).toThrow();
        }
      }
    }
  });
});

describe("clearProfileSecrets — covers every derived slot", () => {
  it("removes exactly one file per (provider, kind) the tables allow", async () => {
    const result = await clearProfileSecrets("profile_1");

    expect(result.success).toBe(true);

    const expectedPaths = PROVIDER_IDS.flatMap((provider) =>
      secretKindsForProvider(provider).map((kind) =>
        getProfileSecretPath("profile_1", provider, kind),
      ),
    );
    const clearedPaths = rmMock.mock.calls.map((call) => String(call[0]));

    expect(clearedPaths.sort()).toEqual([...expectedPaths].sort());
    // Not just "covers them" — no extra deletions either. A stray path here
    // would be a file belonging to some other profile.
    expect(rmMock).toHaveBeenCalledTimes(expectedPaths.length);
  });

  it("never tries to clear a slot the provider does not have", async () => {
    await clearProfileSecrets("profile_1");

    const clearedPaths = rmMock.mock.calls.map((call) => String(call[0]));
    expect(clearedPaths.some((path) => path.includes("ollama"))).toBe(false);
    expect(clearedPaths.some((path) => path.includes("openai-provisioning"))).toBe(
      false,
    );
  });

  it("rejects an invalid profile id without deleting anything", async () => {
    const result = await clearProfileSecrets("../other");

    expect(result).toEqual({ success: false, error: "Invalid profile or provider" });
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("reports a failure but still attempts every slot", async () => {
    rmMock.mockRejectedValueOnce(new Error("EPERM"));

    const result = await clearProfileSecrets("profile_1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("EPERM");
    expect(rmMock).toHaveBeenCalledTimes(3);
  });
});

describe("getActiveProfileSecret", () => {
  it("reads the active profile's secret for a supported slot", async () => {
    await expect(getActiveProfileSecret("openrouter", "api")).resolves.toBe("a-secret");
  });

  it("returns null for a slot the provider does not have, without touching disk", async () => {
    // Ollama has no API key. Callers should not have to branch on that
    // themselves — that hand-rolled branch is what this function replaces.
    await expect(getActiveProfileSecret("ollama", "api")).resolves.toBeNull();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("returns null when there is no active profile", async () => {
    getCurrentProfileIdMock.mockReturnValue("");

    await expect(getActiveProfileSecret("openrouter", "api")).resolves.toBeNull();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the file is missing", async () => {
    readFileMock.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(getActiveProfileSecret("openai", "api")).resolves.toBeNull();
  });
});
