import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockFindFirst,
  mockJobCreate,
  mockRefresh,
  mockSyncStateFindUnique,
  mockProjectCount,
  mockProjectFindMany,
  mockWorkResourceFindMany,
  mockOwnerNoteFindMany,
  mockAnalysisFindUnique,
  mockAnalysisCreate,
  mockAnalysisUpdateMany,
  mockAnalysisUpdate,
} =
  vi.hoisted(() => ({
    mockFindFirst: vi.fn(),
    mockJobCreate: vi.fn(),
    mockRefresh: vi.fn(),
    mockSyncStateFindUnique: vi.fn(),
    mockProjectCount: vi.fn(),
    mockProjectFindMany: vi.fn(),
    mockWorkResourceFindMany: vi.fn(),
    mockOwnerNoteFindMany: vi.fn(),
    mockAnalysisFindUnique: vi.fn(),
    mockAnalysisCreate: vi.fn(),
    mockAnalysisUpdateMany: vi.fn(),
    mockAnalysisUpdate: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  db: {
    project: {
      findFirst: mockFindFirst,
      count: mockProjectCount,
      findMany: mockProjectFindMany,
    },
    workResource: { findMany: mockWorkResourceFindMany },
    ownerNote: { findMany: mockOwnerNoteFindMany },
    repositoryAnalysis: {
      findUnique: mockAnalysisFindUnique,
      create: mockAnalysisCreate,
      updateMany: mockAnalysisUpdateMany,
      update: mockAnalysisUpdate,
    },
    analysisJob: {
      create: mockJobCreate,
    },
    syncState: {
      findUnique: mockSyncStateFindUnique,
    },
  },
}));

vi.mock("@/lib/github-inventory-sync", () => ({
  getInventoryScope: () => "github:accessible-repositories",
  refreshAccessibleInventory: mockRefresh,
}));

const { POST: refresh } = await import("../refresh/route");
const { GET: freshness } = await import("../refresh/route");
const { POST: enrich } = await import("../enrich-next/route");
const { POST: importInventory } = await import("../../github/fetch/route");
const { POST: analyze } = await import("../../github/analyze/route");
const { POST: deepAnalyze } = await import("../../github/deep-analyze/route");

const originalInternalToken = process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
const originalAppOrigin = process.env.GITATLAS_APP_ORIGIN;

beforeEach(() => {
  process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "worker-token";
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockJobCreate.mockReset().mockResolvedValue({ id: "sync-job" });
  mockRefresh.mockReset();
  mockSyncStateFindUnique.mockReset().mockResolvedValue(null);
  mockProjectCount.mockReset().mockResolvedValue(0);
  mockProjectFindMany.mockReset().mockResolvedValue([]);
  mockWorkResourceFindMany.mockReset().mockResolvedValue([]);
  mockOwnerNoteFindMany.mockReset().mockResolvedValue([]);
  mockAnalysisFindUnique.mockReset().mockResolvedValue(null);
  mockAnalysisCreate.mockReset().mockResolvedValue({ id: "analysis-1" });
  mockAnalysisUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockAnalysisUpdate.mockReset().mockResolvedValue({ id: "analysis-1" });
});

afterEach(() => {
  if (originalInternalToken === undefined) delete process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  else process.env.GITATLAS_INTERNAL_SYNC_TOKEN = originalInternalToken;
  if (originalAppOrigin === undefined) delete process.env.GITATLAS_APP_ORIGIN;
  else process.env.GITATLAS_APP_ORIGIN = originalAppOrigin;
});

function makeRequest(path: string, body: unknown, token?: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("internal sync endpoints", () => {
  test("unauthorized inventory refresh does not invoke the writer", async () => {
    const response = await refresh(makeRequest("/api/sync/refresh", {}) as never);

    expect(response.status).toBe(401);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test("unauthorized full import does not invoke inventory reconciliation", async () => {
    const response = await importInventory(
      makeRequest("/api/github/fetch", { username: "caller" }) as never,
    );

    expect(response.status).toBe(401);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test("unauthorized enrichment does not access queued records", async () => {
    const response = await enrich(makeRequest("/api/sync/enrich-next", {
      username: "someone",
      baseUrl: "https://attacker.invalid",
    }) as never);

    expect(response.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  test("unauthorized shallow analysis cannot start LLM calls", async () => {
    const response = await analyze(
      makeRequest("/api/github/analyze", { jobId: "job-1" }) as never,
    );

    expect(response.status).toBe(401);
  });

  test("unauthorized deep analysis cannot start LLM calls", async () => {
    const response = await deepAnalyze(
      makeRequest("/api/github/deep-analyze", {
        username: "someone",
        projectId: "project-1",
      }) as never,
    );

    expect(response.status).toBe(401);
  });

  test("caller-supplied worker URL is ignored and semantic work is bounded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const response = await enrich(makeRequest("/api/sync/enrich-next", {
        username: "someone",
        baseUrl: "https://attacker.invalid",
      }, "worker-token") as never);

      expect(response.status).toBe(200);
      expect((await response.json()).result.status).toBe("idle");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockProjectFindMany).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("authorized refresh invokes inventory reconciliation", async () => {
    mockRefresh.mockResolvedValue({
      status: "current",
      itemCount: 2,
      pagesFetched: 1,
      fetchedAt: new Date("2026-09-30T00:00:00Z"),
      lastSuccessAt: new Date("2026-09-30T00:00:00Z"),
    });

    const response = await refresh(makeRequest(
      "/api/sync/refresh",
      { username: "caller-does-not-select-corpus" },
      "worker-token",
    ) as never);

    expect(response.status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect((await response.json()).itemCount).toBe(2);
  });

  test("freshness reports separate stale inventory and head scopes", async () => {
    mockSyncStateFindUnique.mockImplementation(({ where }: { where: { scope: string } }) =>
      Promise.resolve({
        status: "current",
        fetchedAt: new Date("2026-09-30T00:00:00.000Z"),
        lastSuccessAt: new Date("2026-09-30T00:00:00.000Z"),
        retryAt: null,
        errorCode: null,
        itemCount: where.scope === "github:accessible-repositories" ? 122 : 120,
          unsupportedCount: where.scope === "github:default-branch-heads" ? 2 : 0,
        pagesFetched: 2,
      }),
    );

    const response = await freshness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resources.repositories.status).toBe("stale");
    expect(body.resources.defaultBranchHeads.status).toBe("stale");
    expect(body.status).toBe("stale");
    expect(body.resources.defaultBranchHeads.unsupportedCount).toBe(2);
  });
});
