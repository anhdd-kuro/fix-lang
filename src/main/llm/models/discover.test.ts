/**
 * @file discover.test.ts
 * @description Tests for local (Ollama) model discovery — in particular
 * `probeOllama`, which exists to tell "the daemon is down" apart from "the
 * daemon is up with nothing pulled". Pure unit tests with a mocked client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mocks must be hoisted above the module under test.
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock("../ollama/client", () => ({
  ollamaClient: { list: listMock },
}));
import { getLocalModels, probeOllama } from "./discover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const listed = (...names: string[]) => ({
  models: names.map((name) => ({ name, size: 1234, parameters: {} })),
});

beforeEach(() => {
  vi.clearAllMocks();
  // `discover.ts` is deliberately chatty at [DEBUG] level; keep the suite
  // output readable without changing behaviour.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// D26 — probeOllama distinguishes "unreachable" from "reachable but empty"
//
// `getLocalModels()` swallows every error and returns `[]`, so `[]` means both
// "Ollama isn't running" and "Ollama is running with nothing pulled". The
// Enable/connect flow has to tell a user which, so `probeOllama` calls
// `ollamaClient.list()` directly and keeps the throw that `getLocalModels`
// discards.
// ---------------------------------------------------------------------------

describe("probeOllama — D26", () => {
  it("reports reachable:false when the client throws (daemon down)", async () => {
    listMock.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
        code: "ECONNREFUSED",
      }),
    );

    const probe = await probeOllama();

    expect(probe.reachable).toBe(false);
    expect(probe.models).toEqual([]);
    expect(probe.error).toContain("ECONNREFUSED");
  });

  it("reports reachable:true with no models when the daemon answers empty", async () => {
    listMock.mockResolvedValue({ models: [] });

    const probe = await probeOllama();

    expect(probe.reachable).toBe(true);
    expect(probe.models).toEqual([]);
    expect(probe.error).toBeUndefined();
  });

  it("is the ONLY thing that separates those two cases", async () => {
    // The premise of the whole card, asserted rather than assumed:
    // `getLocalModels()` is `[]` in both states, so a caller reading it alone
    // literally cannot report the truth. If this ever stops being true,
    // `probeOllama` may be redundant — and this test says so.
    listMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const downModels = await getLocalModels();
    const downProbe = await probeOllama();

    listMock.mockResolvedValue({ models: [] });
    const emptyModels = await getLocalModels();
    const emptyProbe = await probeOllama();

    expect(downModels).toEqual(emptyModels);
    expect(downModels).toEqual([]);
    expect(downProbe.reachable).not.toBe(emptyProbe.reachable);
  });

  it("returns the pulled models when the daemon has some", async () => {
    listMock.mockResolvedValue(listed("llama3.2:3b", "qwen2.5-coder:7b"));

    const probe = await probeOllama();

    expect(probe.reachable).toBe(true);
    expect(probe.models.map((model) => model.id)).toEqual([
      "llama3.2:3b",
      "qwen2.5-coder:7b",
    ]);
    expect(probe.error).toBeUndefined();
  });

  it("tags every probed model as ollama and keeps the raw tag as the id", async () => {
    // The explicit `provider` matches what `fetchAvailableModels` stamps on
    // `getLocalModels()` output (`shared.ts:176`). Without it a probed model
    // that reaches the cache would format as `openrouter::…` through
    // `providerOfModel`'s fallback and be billed as OpenRouter.
    listMock.mockResolvedValue(listed("llama3.2:3b"));

    const [model] = (await probeOllama()).models;

    expect(model.provider).toBe("ollama");
    expect(model.id).toBe("llama3.2:3b");
    expect(model.name).toBe("llama3.2");
    expect(model.local?.path).toBe("llama3.2:3b");
    expect(model.pricing).toBeUndefined();
  });

  it("never rejects, whatever the client throws", async () => {
    listMock.mockRejectedValue("a bare string, not an Error");

    await expect(probeOllama()).resolves.toMatchObject({ reachable: false });
  });

  it("treats a malformed response as reachable with nothing pulled", async () => {
    // The daemon answered — that is what `reachable` means. A body we cannot
    // read is not the same failure as no daemon at all.
    listMock.mockResolvedValue(undefined);

    const probe = await probeOllama();

    expect(probe.reachable).toBe(true);
    expect(probe.models).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLocalModels — unchanged, forgiving contract
// ---------------------------------------------------------------------------

describe("getLocalModels — forgiving contract is preserved", () => {
  it("returns [] instead of throwing when the client fails", async () => {
    listMock.mockRejectedValue(new Error("boom"));

    await expect(getLocalModels()).resolves.toEqual([]);
  });

  it("maps pulled models to the cached Model shape", async () => {
    listMock.mockResolvedValue(listed("llama3.2:3b"));

    const [model] = await getLocalModels();

    expect(model.id).toBe("llama3.2:3b");
    expect(model.name).toBe("llama3.2");
    expect(model.local?.path).toBe("llama3.2:3b");
  });

  it("still leaves `provider` unset — its callers stamp it", async () => {
    // `fetchAvailableModels` does `{ ...model, provider: "ollama" }` on this
    // result. Pinned so the shared mapper below cannot start stamping here
    // and silently change what every existing caller receives.
    listMock.mockResolvedValue(listed("llama3.2:3b"));

    const [model] = await getLocalModels();

    expect(model.provider).toBeUndefined();
  });
});
