import { describe, expect, it } from "vitest";
import { getProfileSecretPath } from "./profileSecretStore";

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
