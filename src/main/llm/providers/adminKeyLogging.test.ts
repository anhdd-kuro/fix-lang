/**
 * @file adminKeyLogging.test.ts
 * @description Both admin clients must leave a diagnosable trail for a 401 —
 * the reported bug was a key silently stored in the wrong provider's slot, whose
 * only symptom was "Unauthorized" in the panel and nothing whatsoever in the
 * logs. These tests pin the trail AND pin that the key itself never enters it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAIUsageClient } from "./openai/usage.client";
import { createOpenRouterClient } from "./openrouter/client";
import type { LogContext, LogLevel } from "~/features/logs/shared/logging";

// `vi.mock` is hoisted above every top-level binding, so the sink it writes into
// has to be hoisted with it.
const { entries } = vi.hoisted(() => ({
  entries: [] as {
    level: LogLevel;
    scope: string;
    message: string;
    context?: LogContext;
  }[],
}));

vi.mock("~/main/logging/logService", () => {
  const record =
    (level: LogLevel) => (scope: string, message: string, context?: LogContext) => {
      entries.push({ level, scope, message, context });
    };
  return {
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
});

// Shape-only fixtures — prefix plus filler, never a real credential.
const OPENROUTER_KEY = "sk-or-v1-000000000000";
const OPENAI_ADMIN_KEY = "sk-admin-000000000000";

const errResponse = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  entries.length = 0;
});

describe("OpenRouter admin request logging", () => {
  it("names the foreign key shape on a 401 instead of leaving it a mystery", async () => {
    const client = createOpenRouterClient({
      fetch: (async () => errResponse(401)) as never,
      getKey: async () => OPENAI_ADMIN_KEY,
    });

    await client.getCredits();

    const [failure] = entries.filter((entry) => entry.level === "warn");
    expect(failure?.scope).toBe("provider.openrouter.admin");
    expect(failure?.context).toMatchObject({
      endpoint: "/credits",
      status: 401,
      reason: "unauthorized",
      keyShape: "openai-admin",
      // The whole point: this line, on its own, explains the reported failure.
      storedKeyBelongsToAnotherProvider: true,
    });
  });

  it("omits the foreign-key flag for a correctly-shaped key", async () => {
    const client = createOpenRouterClient({
      fetch: (async () => errResponse(500)) as never,
      getKey: async () => OPENROUTER_KEY,
    });

    await client.getCredits();

    const [failure] = entries.filter((entry) => entry.level === "warn");
    expect(failure?.context?.keyShape).toBe("openrouter");
    expect(failure?.context?.storedKeyBelongsToAnotherProvider).toBeUndefined();
  });

  it("logs a success and the no-key skip, so silence means no attempt at all", async () => {
    const client = createOpenRouterClient({
      fetch: (async () => okResponse({ data: { total_credits: 5, total_usage: 1 } })) as never,
      getKey: async () => OPENROUTER_KEY,
    });
    await client.getCredits();
    expect(entries.some((entry) => entry.level === "debug")).toBe(true);

    entries.length = 0;
    const keyless = createOpenRouterClient({
      fetch: (async () => okResponse({})) as never,
      getKey: async () => null,
    });
    await keyless.getCredits();
    expect(entries[0]?.message).toContain("no key stored");
  });

  it("never writes the key into any log line", async () => {
    const client = createOpenRouterClient({
      fetch: (async () => errResponse(401)) as never,
      getKey: async () => OPENAI_ADMIN_KEY,
    });

    await client.getAnalytics("7d");

    expect(JSON.stringify(entries)).not.toContain(OPENAI_ADMIN_KEY);
  });
});

describe("OpenAI admin request logging", () => {
  it("flags a project key sitting in the admin slot on a 401", async () => {
    const client = createOpenAIUsageClient({
      fetch: (async () => errResponse(401)) as never,
      getKey: async () => "sk-proj-000000000000",
      now: () => new Date("2026-07-01T00:00:00Z"),
    });

    await client.getCosts("7d");

    const [failure] = entries.filter((entry) => entry.level === "warn");
    expect(failure?.scope).toBe("provider.openai.admin");
    expect(failure?.context).toMatchObject({
      status: 401,
      reason: "unauthorized",
      keyShape: "openai-project",
      storedKeyBelongsToAnotherSlot: true,
    });
  });

  it("never writes the key into any log line", async () => {
    const client = createOpenAIUsageClient({
      fetch: (async () => errResponse(403)) as never,
      getKey: async () => OPENAI_ADMIN_KEY,
      now: () => new Date("2026-07-01T00:00:00Z"),
    });

    await client.getUsage("30d");

    expect(JSON.stringify(entries)).not.toContain(OPENAI_ADMIN_KEY);
  });
});
