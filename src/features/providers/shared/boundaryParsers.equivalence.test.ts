/**
 * @file boundaryParsers.equivalence.test.ts
 * @description Pins the exact outputs of the shared provider boundary parsers
 * on edge inputs, so swapping their hand-written `typeof` guards for zod
 * schemas is provably behavior-preserving. The snapshot was recorded against
 * the hand-written implementations.
 */
import { describe, expect, it } from "vitest";
import {
  resolveBedrockRegion,
  sanitizeBedrockRegion,
} from "~/features/providers/shared/bedrockEndpoint";
import {
  resolveLmStudioEndpoint,
  sanitizeLmStudioHost,
  sanitizeLmStudioPort,
  sanitizeProviderEndpoint,
} from "~/features/providers/shared/lmstudioEndpoint";
import { resolveOllamaEndpoint } from "~/features/providers/shared/ollamaEndpoint";
import { sanitizeOpenAIProjectId } from "~/features/providers/shared/openaiProject";
import {
  isProviderId,
  sanitizeEnabledProviders,
  supportsAdminKey,
} from "~/features/providers/shared/providers";

/**
 * Edge inputs reach these parsers from disk or IPC with no static type at all;
 * this models that, so a narrowed parameter type cannot hide a runtime case.
 */
const viaBoundary = <Value>(value: Value): never => value as never;

class EndpointInstance {
  host = "localhost";
  port = 1234;
}

const endpointOnPrototype = Object.create({ host: "localhost", port: 1234 });
const nullPrototypeEndpoint = Object.assign(Object.create(null), {
  host: "localhost",
  port: 1234,
});
const arrayWithEndpointProps = Object.assign(["x"], {
  host: "localhost",
  port: 1234,
});
const functionWithEndpointProps = Object.assign(() => 1, {
  host: "localhost",
  port: 1234,
});

const scalarInputs: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ["0", 0],
  ["-0", -0],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["empty string", ""],
  ["boxed string", new String("openai")],
  ["array", ["openai"]],
  ["function", () => "openai"],
  ["plain object", {}],
];

const describeOutputs = <Output>(
  inputs: [string, unknown][],
  parse: (input: never) => Output,
): [string, Output][] =>
  inputs.map(([label, input]) => [label, parse(viaBoundary(input))]);

describe("provider id guards", () => {
  const inputs: [string, unknown][] = [
    ...scalarInputs,
    ["openai", "openai"],
    ["ollama", "ollama"],
    ["OPENAI", "OPENAI"],
    ["constructor", "constructor"],
    ["toString", "toString"],
    ["__proto__", "__proto__"],
    [" openai", " openai"],
  ];

  it("isProviderId", () => {
    expect(describeOutputs(inputs, isProviderId)).toMatchSnapshot();
  });

  it("supportsAdminKey", () => {
    expect(describeOutputs(inputs, supportsAdminKey)).toMatchSnapshot();
  });

  it("sanitizeEnabledProviders", () => {
    expect(
      describeOutputs(
        [
          ...scalarInputs,
          ["dedupes and orders", ["ollama", "bogus", "openai", "ollama"]],
          ["boxed entries", [new String("openai"), "anthropic"]],
          ["array-like object", { 0: "openai", length: 1 }],
          ["prototype names", ["constructor", "toString", "lmstudio"]],
        ],
        sanitizeEnabledProviders,
      ),
    ).toMatchSnapshot();
  });
});

describe("LM Studio / Ollama endpoint parsers", () => {
  const hostInputs: [string, unknown][] = [
    ...scalarInputs,
    ["localhost", "localhost"],
    ["padded", "  my-host.local  "],
    ["whitespace only", "   "],
    ["253 chars", "a".repeat(253)],
    ["254 chars", "a".repeat(254)],
    ["253 chars padded", ` ${"a".repeat(253)} `],
    ["http", "http"],
    ["HTTPS", "HTTPS"],
    ["https host", "https.example"],
    ["with port", "127.0.0.1:1234"],
    ["with path", "127.0.0.1/v1"],
    ["with query", "h?x"],
    ["with hash", "h#x"],
    ["with userinfo", "u@h"],
    ["inner space", "bad host"],
    ["tab", "\th\t"],
    ["ipv6 literal", "::1"],
  ];

  const portInputs: [string, unknown][] = [
    ...scalarInputs,
    ["1", 1],
    ["1234", 1234],
    ["65535", 65535],
    ["65536", 65536],
    ["-1", -1],
    ["12.5", 12.5],
    ["2^53", 2 ** 53],
    ["string 8080", "8080"],
    ["padded string", " 8080 "],
    ["blank string", "   "],
    ["hex string", "0x10"],
    ["exponent string", "1e3"],
    ["decimal string", "12.0"],
    ["fraction string", "12.5"],
    ["word", "nope"],
    ["string 0", "0"],
    ["string 65536", "65536"],
    ["boxed number", new Number(80)],
    ["array of number", [8080]],
  ];

  const endpointInputs: [string, unknown][] = [
    ...scalarInputs,
    ["valid", { host: "localhost", port: 1234 }],
    ["string port", { host: "localhost", port: "8080" }],
    ["padded host", { host: "  localhost ", port: 1234 }],
    ["extra keys", { host: "localhost", port: 1234, path: "/v1" }],
    ["missing host", { port: 1234 }],
    ["missing port", { host: "localhost" }],
    ["scheme host", { host: "http://x", port: 1234 }],
    ["NaN port", { host: "localhost", port: Number.NaN }],
    ["class instance", new EndpointInstance()],
    ["inherited fields", endpointOnPrototype],
    ["null prototype", nullPrototypeEndpoint],
    ["array with fields", arrayWithEndpointProps],
    ["function with fields", functionWithEndpointProps],
  ];

  it("sanitizeLmStudioHost", () => {
    expect(describeOutputs(hostInputs, sanitizeLmStudioHost)).toMatchSnapshot();
  });

  it("sanitizeLmStudioPort", () => {
    expect(describeOutputs(portInputs, sanitizeLmStudioPort)).toMatchSnapshot();
  });

  it("sanitizeProviderEndpoint", () => {
    expect(
      describeOutputs(endpointInputs, sanitizeProviderEndpoint),
    ).toMatchSnapshot();
  });

  it("resolveLmStudioEndpoint", () => {
    expect(
      describeOutputs(endpointInputs, resolveLmStudioEndpoint),
    ).toMatchSnapshot();
  });

  it("resolveOllamaEndpoint", () => {
    expect(
      describeOutputs(endpointInputs, resolveOllamaEndpoint),
    ).toMatchSnapshot();
  });
});

describe("Bedrock region parsers", () => {
  const regionInputs: [string, unknown][] = [
    ...scalarInputs,
    ["valid", "us-east-1"],
    ["padded mixed case", " EU-West-1 "],
    ["two-digit suffix", "us-east-12"],
    ["no suffix", "invalid"],
    ["33 chars", `us-${"a".repeat(28)}-1`],
    ["boxed region", new String("us-east-1")],
  ];

  const resolveInputs: [string, unknown][] = [
    ...regionInputs,
    ["endpoint object", { host: "ap-northeast-1" }],
    ["endpoint with port", { host: "ap-northeast-1", port: 0 }],
    ["padded endpoint host", { host: " AP-NORTHEAST-1 " }],
    ["invalid endpoint host", { host: "bad" }],
    ["non-string endpoint host", { host: 5 }],
    ["undefined endpoint host", { host: undefined }],
    ["no host key", { port: 1 }],
    ["array with region", ["us-east-1"]],
    ["array with host field", Object.assign([], { host: "us-west-2" })],
    ["inherited host", Object.create({ host: "us-west-2" })],
    [
      "class instance",
      new (class {
        host = "eu-central-1";
      })(),
    ],
  ];

  it("sanitizeBedrockRegion", () => {
    expect(
      describeOutputs(regionInputs, sanitizeBedrockRegion),
    ).toMatchSnapshot();
  });

  it("resolveBedrockRegion", () => {
    expect(
      describeOutputs(resolveInputs, resolveBedrockRegion),
    ).toMatchSnapshot();
  });
});

describe("OpenAI project id parser", () => {
  it("sanitizeOpenAIProjectId", () => {
    expect(
      describeOutputs(
        [
          ...scalarInputs,
          ["valid", "proj_abc123"],
          ["padded", "  proj_abc123\n"],
          ["whitespace only", "   "],
          ["prefix only", "proj_"],
          ["org id", "org-abc123"],
          ["inner space", "proj_has space"],
          ["boxed", new String("proj_abc123")],
          ["121-char token", `proj_${"a".repeat(121)}`],
        ],
        sanitizeOpenAIProjectId,
      ),
    ).toMatchSnapshot();
  });
});
