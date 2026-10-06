// src/app/api/webhooks/github/__tests__/route.test.ts
//
// Integration tests for the GitHub webhook receiver.
//
// Strategy:
//   - The real node:crypto is used throughout. We compute valid HMAC-SHA256
//     signatures in the test so the cryptographic path is exercised, not
//     stubbed. This proves the route accepts exactly the right tokens and
//     nothing else.
//   - Only @/lib/db is mocked because it needs a live Prisma connection.
//     Everything else (crypto, JSON parsing, Next response) is real.
//   - Every happy-path assertion has a matching failure-path companion.
//
// Fail-closed contract (the most important thing this file verifies):
//   1. Missing GITHUB_WEBHOOK_SECRET → 503, not a 2xx that silently writes.
//   2. Wrong / absent signature → 401, not processed.
//   3. The route NEVER touches the DB without first passing HMAC verification.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── DB mock ─────────────────────────────────────────────────────────────────
// Must be set up BEFORE the route is dynamically imported below so Vitest's
// module registry serves the mock to the route's static import of @/lib/db.
const { mockUpdate } = vi.hoisted(() => ({
  mockUpdate: vi.fn((..._args: unknown[]) => Promise.resolve({ githubId: 1 })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    project: {
      update: mockUpdate,
    },
  },
}));

// Dynamic import so the route resolves @/lib/db AFTER the mock is registered.
const { POST } = await import('../route');

// ── test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = 'super-secret-test-key-abc123';

function hmacSign(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeRequest(
  body: string,
  headers: Record<string, string>,
): Request {
  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    body,
    headers,
  });
}

const PUSH_PAYLOAD = JSON.stringify({
  repository: {
    id: 42,
    full_name: 'user/atlas',
    updated_at: '2024-06-01T12:00:00Z',
    pushed_at: '2024-06-01T12:00:00Z',
  },
});

// ── lifecycle ─────────────────────────────────────────────────────────────────

const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
  mockUpdate.mockClear();
  // Restore default implementation after each test clears it
  mockUpdate.mockImplementation(() => Promise.resolve({ githubId: 1 }));
});

afterEach(() => {
  // Restore env to whatever it was before this file ran
  if (originalSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
  }
});

// ── fail-closed security ──────────────────────────────────────────────────────

describe('fail-closed security', () => {
  test('503 when GITHUB_WEBHOOK_SECRET env var is not set', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;

    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': hmacSign(TEST_SECRET, PUSH_PAYLOAD),
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
    // DB must never be touched without a verified secret
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('401 when x-hub-signature-256 header is absent', async () => {
    const req = makeRequest(PUSH_PAYLOAD, {
      'x-github-event': 'push',
      // no signature header
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid signature');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('401 when signature has correct format but wrong HMAC value', async () => {
    // Same length as a real sha256 hex, but all zeros – catches timingSafeEqual failure
    const wrongSig = 'sha256=' + '0'.repeat(64);

    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': wrongSig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('401 when payload body is tampered after signing', async () => {
    // Signed against the original body, but a different body is delivered
    const tamperedBody = JSON.stringify({ repository: { id: 999, full_name: 'evil/repo' } });
    const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD); // signed against different body

    const req = makeRequest(tamperedBody, {
      'x-hub-signature-256': sig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── valid push / repository / create events ───────────────────────────────────

describe('valid signed events', () => {
  test('200 and marks repo stale on push event', async () => {
    const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD);
    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': sig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.marked).toBe('user/atlas');
    expect(body.event).toBe('push');

    // DB was called exactly once with the right args
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [callArgs] = mockUpdate.mock.calls;
    expect(callArgs[0]).toMatchObject({
      where: { githubId: 42 },
      data: { analyzedAt: null, deepAnalyzedAt: null },
    });
  });

  test('200 on repository event (treated same as push)', async () => {
    const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD);
    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': sig,
      'x-github-event': 'repository',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('200 on create event (new branch/tag push)', async () => {
    const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD);
    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': sig,
      'x-github-event': 'create',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ── ignored / edge-case events ────────────────────────────────────────────────

describe('ignored events', () => {
  test('200 noop for unrecognised event types (star, watch, fork, etc.)', async () => {
    for (const event of ['star', 'watch', 'fork', 'ping']) {
      mockUpdate.mockClear();
      const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD);
      const req = makeRequest(PUSH_PAYLOAD, {
        'x-hub-signature-256': sig,
        'x-github-event': event,
      });

      const res = await POST(req as any);
      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe(event);
      expect(mockUpdate).not.toHaveBeenCalled();
    }
  });

  test('200 noop when repository field is missing from payload', async () => {
    const noRepoPayload = JSON.stringify({ action: 'opened' });
    const sig = hmacSign(TEST_SECRET, noRepoPayload);
    const req = makeRequest(noRepoPayload, {
      'x-hub-signature-256': sig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toMatch(/no repository/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  test('400 when body is valid-signed but not JSON', async () => {
    const badBody = 'this is not { json }';
    const sig = hmacSign(TEST_SECRET, badBody);
    const req = makeRequest(badBody, {
      'x-hub-signature-256': sig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  test('200 with missing:true when DB update throws (repo not synced locally)', async () => {
    mockUpdate.mockImplementation(() => Promise.reject(new Error('Record to update not found')));

    const sig = hmacSign(TEST_SECRET, PUSH_PAYLOAD);
    const req = makeRequest(PUSH_PAYLOAD, {
      'x-hub-signature-256': sig,
      'x-github-event': 'push',
    });

    const res = await POST(req as any);
    // Must NOT 500 – GitHub would stop delivering future events on a 5xx
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missing).toBe(true);
    expect(body.error).toBe('Record to update not found');
  });
});
