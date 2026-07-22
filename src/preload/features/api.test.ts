/**
 * @file api.test.ts
 * @description Validation unit tests for the staged provider-setup input
 * guard (`isProviderSetupInput`) used at the preload boundary before any IPC
 * call. Pure shape-rejection tests — electron's ipcRenderer is mocked since
 * the module imports it, but no invocation happens for these tests.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({
  ipcRenderer: { invoke: vi.fn(), send: vi.fn() },
}));
import { isProviderSetupInput } from "./api";
import type { ProviderSetupInput } from "./api";

describe("isProviderSetupInput", () => {
  it("accepts a minimal valid input", () => {
    const input: ProviderSetupInput = { provider: "openai", modelId: "gpt-4o" };
    expect(isProviderSetupInput(input)).toBe(true);
  });

  it("accepts a full input with apiKey and provisioningKey", () => {
    const input: ProviderSetupInput = {
      provider: "openrouter",
      modelId: "anthropic/claude-3",
      apiKey: "sk-or-abc",
      provisioningKey: "sk-or-prov",
    };
    expect(isProviderSetupInput(input)).toBe(true);
  });

  it("accepts every valid provider id", () => {
    (["openai", "openrouter", "ollama"] as const).forEach((provider) => {
      expect(isProviderSetupInput({ provider, modelId: "m" })).toBe(true);
    });
  });

  it("rejects a bad/unknown provider", () => {
    expect(
      isProviderSetupInput({
        provider: "anthropic" as ProviderSetupInput["provider"],
        modelId: "gpt-4o",
      }),
    ).toBe(false);
  });

  it("rejects a non-string modelId", () => {
    expect(
      isProviderSetupInput({
        provider: "openai",
        modelId: 123 as unknown as string,
      }),
    ).toBe(false);
  });

  it("rejects a non-string apiKey", () => {
    expect(
      isProviderSetupInput({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: 123 as unknown as string,
      }),
    ).toBe(false);
  });

  it("rejects a non-string provisioningKey", () => {
    expect(
      isProviderSetupInput({
        provider: "openrouter",
        modelId: "gpt-4o",
        provisioningKey: {} as unknown as string,
      }),
    ).toBe(false);
  });
});
