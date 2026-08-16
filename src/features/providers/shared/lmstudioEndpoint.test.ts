import { describe, expect, it } from "vitest";
import {
  buildLmStudioBaseUrl,
  isLoopbackHost,
  LMSTUDIO_DEFAULT_ENDPOINT,
  resolveLmStudioEndpoint,
  sanitizeLmStudioHost,
  sanitizeLmStudioPort,
  sanitizeProviderEndpoint,
} from "./lmstudioEndpoint";

describe("sanitizeLmStudioHost", () => {
  it("accepts localhost and IPv4", () => {
    expect(sanitizeLmStudioHost("localhost")).toBe("localhost");
    expect(sanitizeLmStudioHost("127.0.0.1")).toBe("127.0.0.1");
    expect(sanitizeLmStudioHost("  my-host.local  ")).toBe("my-host.local");
  });

  it("rejects schemes, paths, ports, and whitespace", () => {
    expect(sanitizeLmStudioHost("http://127.0.0.1")).toBeNull();
    expect(sanitizeLmStudioHost("127.0.0.1/v1")).toBeNull();
    expect(sanitizeLmStudioHost("127.0.0.1:1234")).toBeNull();
    expect(sanitizeLmStudioHost("bad host")).toBeNull();
    expect(sanitizeLmStudioHost("")).toBeNull();
    expect(sanitizeLmStudioHost(null)).toBeNull();
  });
});

describe("sanitizeLmStudioPort", () => {
  it("accepts integers in 1..65535", () => {
    expect(sanitizeLmStudioPort(1234)).toBe(1234);
    expect(sanitizeLmStudioPort("8080")).toBe(8080);
  });

  it("rejects out-of-range and non-integers", () => {
    expect(sanitizeLmStudioPort(0)).toBeNull();
    expect(sanitizeLmStudioPort(65536)).toBeNull();
    expect(sanitizeLmStudioPort(12.5)).toBeNull();
    expect(sanitizeLmStudioPort("nope")).toBeNull();
  });
});

describe("sanitizeProviderEndpoint / resolveLmStudioEndpoint", () => {
  it("sanitizes a valid endpoint object", () => {
    expect(sanitizeProviderEndpoint({ host: "localhost", port: 1234 })).toEqual(
      {
        host: "localhost",
        port: 1234,
      },
    );
  });

  it("falls back to defaults when invalid", () => {
    expect(resolveLmStudioEndpoint(null)).toEqual(LMSTUDIO_DEFAULT_ENDPOINT);
    expect(resolveLmStudioEndpoint({ host: "http://x", port: 1234 })).toEqual(
      LMSTUDIO_DEFAULT_ENDPOINT,
    );
  });
});

describe("buildLmStudioBaseUrl", () => {
  it("builds the OpenAI-compatible /v1 base URL", () => {
    expect(buildLmStudioBaseUrl({ host: "127.0.0.1", port: 1234 })).toBe(
      "http://127.0.0.1:1234/v1",
    );
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0:0:0:0:0:0:0:1"])(
    "treats %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  // The direction that leaks. `sanitizeLmStudioHost` accepts every one of
  // these, so a "local" provider can be pointed at any of them.
  it.each([
    "192.168.1.50",
    "10.0.0.2",
    "example.com",
    "ollama.internal",
    "128.0.0.1",
    "27.0.0.1",
    "999.0.0.1",
    "",
    "   ",
  ])("treats %s as NOT loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it.each([42, null, undefined, {}])("treats non-strings as NOT loopback: %p", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it("does not resolve names, so a name pointing at loopback still reads remote", () => {
    expect(isLoopbackHost("localhost.evil.com")).toBe(false);
  });
});
