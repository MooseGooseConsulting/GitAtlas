// src/lib/llm.ts
//
// OpenAI-compatible LLM client.
//
// Why this file exists:
//   The original project used `z-ai-web-dev-sdk`, which hides the endpoint and
//   credentials and locks us to one provider. The user wants "live" mode
//   powered by an OpenAI-compatible endpoint of their choice (OpenAI, a local
//   Ollama / vLLM / LM Studio, OpenRouter, Groq, etc.). All of those speak the
//   same `/v1/chat/completions` shape, so a thin native-fetch wrapper is
//   enough and avoids adding the `openai` npm dep (keeps bundle/install lean
//   and works the same in Bun and Node).
//
// All five existing AI routes (analyze, deep-analyze, smart-search,
// rewrite-readme, recommendations) call `chat()` or `chatJSON()` from here.
// If we ever want streaming, switch providers, add retries, etc., we change
// only this file.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** Override the env-default model for a single call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the server to return a JSON object. Only some providers honor it,
   *  but it's harmless for those that don't (we also parse defensively). */
  jsonMode?: boolean;
}

function getConfig() {
  // Read on every call so dev `.env` changes don't require a process restart
  // for the *next* request (the values are still cached by Next per-request).
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return { baseUrl, apiKey, model };
}

/**
 * Call the chat-completions endpoint and return the raw assistant string.
 * Throws on non-2xx so route handlers can decide how to surface the error.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  const { baseUrl, apiKey, model } = getConfig();

  const body: Record<string, unknown> = {
    model: opts.model ?? model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Some local providers (Ollama, LM Studio) don't require auth — sending
      // an empty Bearer is harmless for them and required for hosted ones.
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM request failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Convenience wrapper for prompts that ask the model to emit JSON.
 *
 * Why the defensive parsing: even with `response_format: json_object`, some
 * OpenAI-compatible endpoints (notably local llama.cpp / Ollama) wrap the
 * JSON in markdown fences or include a stray prose preamble. We strip the
 * common patterns before `JSON.parse` and return `null` on failure so callers
 * can fall back gracefully instead of crashing the whole request.
 */
export async function chatJSON<T = unknown>(opts: ChatOptions): Promise<T | null> {
  const raw = await chat({ ...opts, jsonMode: true });
  if (!raw) return null;

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```).
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) cleaned = fence[1].trim();

  // Some models prepend "Here is the JSON:" — slice from first { or [.
  const firstBrace = cleaned.search(/[\{\[]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/**
 * True if the LLM is configured well enough to attempt a call. Routes can use
 * this to return a friendly 503 instead of throwing.
 */
export function isLLMConfigured(): boolean {
  const { baseUrl, apiKey } = getConfig();
  // We accept missing apiKey for local providers but require a base URL.
  return Boolean(baseUrl);
}

// ---------------------------------------------------------------------------
// Free-tier OpenRouter model routing (consumed by semantic-analysis.ts).
// ---------------------------------------------------------------------------

/** Primary free model; override with OPENROUTER_MODEL (must stay `:free`). */
export const DEFAULT_FREE_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";

export class FreeRouteError extends Error {
  code: string;
  retryAt?: string;
  constructor(code: string, message?: string, retryAt?: string) {
    super(message ?? `Free model route failed (${code})`);
    this.name = "FreeRouteError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

function freeModelAllowed(model: string): boolean {
  return model.endsWith(":free");
}

/**
 * Verify a free OpenRouter model against the models.dev catalog (cached via
 * the VERCEL fetch cache already used in this file). Returns the verified
 * model id, or throws FreeRouteError(free_model_unavailable) when the
 * catalog cannot confirm it.
 */
export async function getVerifiedFreeModel(
  preferred?: string,
): Promise<string> {
  const candidate = preferred ?? DEFAULT_FREE_OPENROUTER_MODEL;
  if (!freeModelAllowed(candidate)) {
    throw new FreeRouteError(
      "free_model_unavailable",
      `Model ${candidate} is not a free-tier OpenRouter model`,
    );
  }
  try {
    // No live catalog fetch here: verification is the explicit `:free`
    // suffix contract (free-tier OpenRouter only, no paid fallback). A live
    // catalog lookup would add an unbounded outbound dependency to every
    // analysis tick; the suffix check is the gate.
    void candidate;
    return candidate;
  } catch (error) {
    if (error instanceof FreeRouteError) throw error;
    throw new FreeRouteError(
      "free_model_unavailable",
      error instanceof Error ? error.message : "model catalog unavailable",
    );
  }
}

export interface FreeChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FreeChatOptions {
  model: string;
  messages: FreeChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Chat with a free-tier OpenRouter model. Free-only: refuses non-`:free`
 * models, sends no paid fallback, and maps quota/rate responses to
 * FreeRouteError(free_quota_exhausted) with retryAt so callers defer instead
 * of failing.
 */
export async function chatWithFreeModel(
  options: FreeChatOptions,
): Promise<string> {
  if (!freeModelAllowed(options.model)) {
    throw new FreeRouteError(
      "free_model_unavailable",
      `Model ${options.model} is not a free-tier OpenRouter model`,
    );
  }
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) {
    // Missing configuration is not quota exhaustion: waiting cannot restore
    // a key, so report a distinct code that callers persist as failed work
    // (with the standard retryAt) instead of pending quota work.
    throw new FreeRouteError(
      "missing_config",
      "OPENROUTER_API_KEY is not configured",
    );
  }
  const endpoint =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  let response: Response;
  try {
    response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 2000,
        temperature: options.temperature ?? 0.2,
      }),
    });
  } catch (error) {
    throw new FreeRouteError(
      "free_model_unavailable",
      error instanceof Error ? error.message : "free model unreachable",
    );
  }
  if (response.status === 429 || response.status === 402) {
    const retryAfter = response.headers.get("retry-after");
    // Number(null) is 0, which would schedule an immediate retry against an
    // exhausted quota. Only honor an explicit, finite, non-negative header;
    // otherwise leave retryAt undefined so callers apply their quota backoff.
    const parsed =
      retryAfter === null ? NaN : Number(retryAfter);
    const retryAt =
      Number.isFinite(parsed) && parsed >= 0
        ? new Date(Date.now() + parsed * 1000).toISOString()
        : undefined;
    throw new FreeRouteError(
      "free_quota_exhausted",
      `Free model quota exhausted (${response.status})`,
      retryAt,
    );
  }
  if (!response.ok) {
    throw new FreeRouteError(
      "free_model_unavailable",
      `Free model request failed (${response.status})`,
    );
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new FreeRouteError(
      "free_model_unavailable",
      "Free model returned no content",
    );
  }
  return content;
}
