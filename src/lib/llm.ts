// src/lib/llm.ts
//
// LEGACY COMPATIBILITY: direct OpenAI-compatible LLM client.
//
// This file powers the pre-#10 in-app AI enrichment routes. It is retained
// while issue #10 establishes the new thin handoff to an existing capable
// coding/research harness.
//
// IMPORTANT: do not evolve this wrapper into a GitAtlas agent runtime, model
// router, tool loop, retry/orchestration framework, or semantic backend.
// New repository/corpus semantic work should use the harness boundary and
// versioned prompts/skills described in docs/architecture.md and issues #9-#19.
//
// Existing routes may continue to depend on chat()/chatJSON() until their
// replacement path is proven and compatibility requirements are understood.

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
 *
 * NOTE: this behavior is legacy. New semantic workflows introduced by #10+
 * should use the existing harness's supported structured-output mechanism,
 * not extend this parser.
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
