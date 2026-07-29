/**
 * @file ollamaEndpoint.test.ts
 * @description Defaults and URL builder for the Ollama local daemon endpoint.
 */
import { describe, expect, it } from "vitest";
import {
  OLLAMA_DEFAULT_ENDPOINT,
  buildOllamaBaseUrl,
  resolveOllamaEndpoint,
} from "./ollamaEndpoint";

describe("resolveOllamaEndpoint", () => {
  it("falls back to 127.0.0.1:11434", () => {
    expect(resolveOllamaEndpoint(undefined)).toEqual(OLLAMA_DEFAULT_ENDPOINT);
    expect(resolveOllamaEndpoint(null)).toEqual({
      host: "127.0.0.1",
      port: 11434,
    });
  });

  it("accepts a valid host/port pair", () => {
    expect(resolveOllamaEndpoint({ host: "192.168.1.10", port: 11435 })).toEqual({
      host: "192.168.1.10",
      port: 11435,
    });
  });
});

describe("buildOllamaBaseUrl", () => {
  it("builds an origin without a /v1 path (Ollama client host)", () => {
    expect(buildOllamaBaseUrl(OLLAMA_DEFAULT_ENDPOINT)).toBe(
      "http://127.0.0.1:11434",
    );
  });
});
