/**
 * @file httpKeepAlive.ts
 * @description Long-lived keep-alive HTTP dispatcher shared by every cloud
 * provider request (OpenAI, OpenRouter) and by the connection prewarmer
 * (`./prewarm`).
 *
 * Undici already pools connections per origin — but its default agent's
 * keep-alive window is only a few
 * seconds, long enough to survive one multi-turn conversation, too short to
 * survive the gap between two hotkey presses. A dedicated `undici.Agent` with
 * a multi-minute `keepAliveTimeout` keeps the socket to api.openai.com /
 * openrouter.ai alive across that gap, so a hotkey pressed minutes after the
 * last one can reuse an already-warm connection instead of paying
 * DNS + TCP + TLS again.
 *
 * One agent for both cloud providers: they are different origins, and
 * undici's `Agent` pools per-origin internally, so sharing an instance never
 * mixes their sockets.
 *
 * `fetch` and `Agent` must come from the same undici package. Node and Electron
 * embed their own undici version, whose dispatcher handler contract can differ
 * from the installed package. Passing an installed v8 Agent to Node's embedded
 * v7 fetch, for example, fails before connecting with
 * `invalid onRequestStart method`.
 */
import { Agent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";

/** Long enough that back-to-back hotkey presses minutes apart reuse a socket. */
const KEEP_ALIVE_TIMEOUT_MS = 5 * 60 * 1000;

/** Upper bound undici enforces regardless of what a server's response asks for. */
const KEEP_ALIVE_MAX_TIMEOUT_MS = 10 * 60 * 1000;

const keepAliveAgent: Dispatcher = new Agent({
  keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
  keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
});

/**
 * Drop-in replacement for `globalThis.fetch`, bound to {@link keepAliveAgent}.
 * Pass this as the `fetch` option to `createOpenAI` / `createOpenRouter` so
 * every AI SDK request — and the prewarm probe in `./prewarm` — shares the
 * same pooled, long-lived sockets. Scoped deliberately: only callers that pass
 * this function opt into the keep-alive agent, so unrelated fetch traffic
 * (Homebrew/GitHub update checks, etc.) is unaffected.
 */
export const keepAliveFetch: typeof fetch = (input, init) =>
  undiciFetch(input, { ...(init ?? {}), dispatcher: keepAliveAgent } as Parameters<typeof undiciFetch>[1]) as ReturnType<
    typeof fetch
  >;
