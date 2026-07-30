import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_SUPPORTS_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
} from "~/features/providers/shared/providers";
const { rmMock, readFileMock, writeFileMock, getCurrentProfileIdMock } = vi.hoisted(
  () => ({
    rmMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    getCurrentProfileIdMock: vi.fn(),
  }),
);
vi.mock("node:fs/promises", () => {
  const api = {
    rm: rmMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
  };
  // `default` too: a transitive importer needs it, or the whole file fails to load.
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
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: getCurrentProfileIdMock,
}));
import {
  clearProfileSecrets,
  getActiveProfileSecret,
  getProfileSecretPath,
  secretKindsForProvider,
  setProfileSecret,
  type SecretKind,
} from "~/features/providers/store/profileSecretStore";

beforeEach(() => {
  vi.clearAllMocks();
  rmMock.mockResolvedValue(undefined);
  writeFileMock.mockResolvedValue(undefined);
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
      getProfileSecretPath("profile_1", "lmstudio", "provisioning"),
    ).toThrow("Only OpenAI and OpenRouter use an admin key");
  });
});

// Expectations below are computed from the provider tables, never a literal list:
// literals would pass just as happily against the hand-written branches they replaced.
describe("secretKindsForProvider — derived from the provider tables", () => {
  it.each([...PROVIDER_IDS])("matches the tables for %s", (provider) => {
    const expected: SecretKind[] = [];
    if (PROVIDER_SUPPORTS_API_KEY[provider]) expected.push("api");
    if (provider === "bedrock") expected.push("secret");
    if (PROVIDER_SUPPORTS_PROVISIONING_KEY[provider]) expected.push("provisioning");

    expect(secretKindsForProvider(provider)).toEqual(expected);
  });

  it("gives a keyless provider no slots at all", () => {
    expect(secretKindsForProvider("ollama")).toEqual([]);
  });

  it("gives lmstudio an optional api slot", () => {
    expect(secretKindsForProvider("lmstudio")).toEqual(["api"]);
  });

  it("accepts exactly the pairs getProfileSecretPath accepts", () => {
    for (const provider of PROVIDER_IDS) {
      const kinds = secretKindsForProvider(provider);
      for (const kind of ["api", "secret", "provisioning"] as const) {
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
    // No extra deletions either: a stray path would be another profile's file.
    expect(rmMock).toHaveBeenCalledTimes(expectedPaths.length);
  });

  it("never tries to clear a slot the provider does not have", async () => {
    await clearProfileSecrets("profile_1");

    const clearedPaths = rmMock.mock.calls.map((call) => String(call[0]));
    expect(clearedPaths.some((path) => path.includes("ollama"))).toBe(false);
    expect(
      clearedPaths.some((path) => path.includes("lmstudio-provisioning")),
    ).toBe(false);
    // OpenAI now HAS an admin slot, so its file must be among the deletions —
    // a profile deletion that skipped it would leave a billing-scoped key behind.
    expect(clearedPaths.some((path) => path.includes("openai-provisioning"))).toBe(
      true,
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
    // Derived, not a literal: a new provider slot must widen this automatically
    // rather than pass while the failing slot's siblings went unattempted.
    expect(rmMock).toHaveBeenCalledTimes(
      PROVIDER_IDS.flatMap((provider) => secretKindsForProvider(provider)).length,
    );
  });
});

describe("setProfileSecret refuses a key that belongs to another slot", () => {
  it("does not write an OpenAI admin key into OpenRouter's admin slot", async () => {
    // The store is the chokepoint: the IPC handler checks this too, but a future
    // writer that skips the handler must not be able to recreate the bug —
    // stored fine, badge said "Key set", every account read came back 401.
    const result = await setProfileSecret(
      "profile_1",
      "openrouter",
      "provisioning",
      "sk-admin-abc",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("sk-or-v1-");
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("does not write an OpenRouter key into either OpenAI slot", async () => {
    for (const kind of ["api", "provisioning"] as const) {
      expect(
        (await setProfileSecret("profile_1", "openai", kind, "sk-or-v1-abc")).success,
      ).toBe(false);
    }
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes a correctly-shaped key, and an unrecognized format, unchanged", async () => {
    for (const [provider, kind, key] of [
      ["openrouter", "provisioning", "sk-or-v1-abc"],
      ["openai", "provisioning", "sk-admin-abc"],
      ["openai", "api", "sk-proj-abc"],
      // A legacy `sk-…` key must never be refused on a guess.
      ["openai", "api", "sk-legacy-key"],
      ["lmstudio", "api", "anything-local"],
    ] as const) {
      const result = await setProfileSecret("profile_1", provider, kind, key);
      expect(result).toEqual({ success: true });
    }
    expect(writeFileMock).toHaveBeenCalledTimes(5);
  });
});

describe("getActiveProfileSecret", () => {
  it("reads the active profile's secret for a supported slot", async () => {
    await expect(getActiveProfileSecret("openrouter", "api")).resolves.toBe("a-secret");
  });

  it("returns null for a slot the provider does not have, without touching disk", async () => {
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
