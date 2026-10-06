// src/lib/__tests__/llm.test.ts
import { expect, test, describe } from 'vitest';

// Why test this: our system depends on structured JSON from LLMs that 
// often inject prose or markdown fences. Our 'chatJSON' method must be 
// resilient to these quirks to avoid breaking the frontend.

/**
 * Mocking a basic "dirty" JSON extractor similar to our implementation in llm.ts
 * Note: Since I'm an agent, I'm defining the logic here to verify the concept
 * before suggesting a full Vitest/Jest setup.
 */
function cleanJson(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
}

describe('LLM JSON Sanitization', () => {
  test('strips markdown json blocks', () => {
    const raw = '```json\n{"name": "test"}\n```';
    expect(JSON.parse(cleanJson(raw)).name).toBe('test');
  });

  test('strips generic code blocks', () => {
    const raw = '```\n{"id": 123}\n```';
    expect(JSON.parse(cleanJson(raw)).id).toBe(123);
  });

  test('handles raw json objects', () => {
    const raw = '{"ok": true}';
    expect(JSON.parse(cleanJson(raw)).ok).toBe(true);
  });
});
