import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockProjectCount,
  mockProjectGroupBy,
  mockSyncStateFindMany,
  mockWorkResourceGroupBy,
  mockLoadWorkQueues,
} = vi.hoisted(() => ({
  mockProjectCount: vi.fn(),
  mockProjectGroupBy: vi.fn(),
  mockSyncStateFindMany: vi.fn(),
  mockWorkResourceGroupBy: vi.fn(),
  mockLoadWorkQueues: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { count: mockProjectCount, groupBy: mockProjectGroupBy },
    syncState: { findMany: mockSyncStateFindMany },
    workResource: { groupBy: mockWorkResourceGroupBy },
  },
}));

vi.mock("@/lib/work-queues-server", () => ({
  loadWorkQueues: mockLoadWorkQueues,
}));

const { GET } = await import("../route");

beforeEach(() => {
  mockProjectCount.mockReset().mockImplementation((args?: { where?: { isArchived?: boolean } }) =>
    args?.where?.isArchived ? Promise.resolve(0) : Promise.resolve(3),
  );
  mockProjectGroupBy.mockReset().mockImplementation((args) => {
    if (args.by[0] === "inventoryStatus") {
      return [
        { inventoryStatus: "current", _count: { _all: 2 } },
        { inventoryStatus: "unverified", _count: { _all: 1 } },
      ];
    }
    return [
      { visibility: "public", _count: { _all: 1 } },
      { visibility: "private", _count: { _all: 2 } },
    ];
  });
  mockSyncStateFindMany.mockReset().mockImplementation((args) => {
    const scopeFilter = args?.where?.scope ?? {};
    if (scopeFilter.in) {
      return Promise.resolve([
        {
          scope: "github:accessible-repositories",
          status: "partial",
          fetchedAt: new Date("2026-09-30T11:00:00.000Z"),
          lastSuccessAt: new Date("2026-09-30T11:00:00.000Z"),
          errorCode: "rate_limited",
          itemCount: 2,
          pagesFetched: 3,
        },
      ]);
    }
    return Promise.resolve([
      {
        scope: "github:work-resources:1:issue",
        status: "current",
        // Clock-relative on purpose: the corpus scope label recomputes
        // staleness against the real clock (WORK_SCOPE_STALE_MS = 6h), so a
        // pinned date silently decays this fixture to retained_unverified.
        lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000),
        errorCode: null,
        itemCount: 4,
        unsupportedCount: 0,
      },
      {
        scope: "github:work-resources:1:agents",
        status: "unsupported",
        lastSuccessAt: null,
        errorCode: "source_unavailable",
        itemCount: 0,
        unsupportedCount: 1,
      },
    ]);
  });
  mockWorkResourceGroupBy.mockReset().mockResolvedValue([
    { sourceType: "issue", _count: { _all: 4 } },
  ]);
  mockLoadWorkQueues.mockReset().mockResolvedValue({
    generatedAt: "2026-09-30T12:00:00.000Z",
    queues: {
      attention: [],
      active: [],
      recent: [],
      blocked: [],
      ready: [],
      stale: [],
    },
    uncertain: [],
    coverage: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/portfolio", () => {
  test("aggregates corpus counts, inventory freshness and per-type work scopes", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emptyCorpus).toBe(false);
    expect(body.corpus).toEqual({
      total: 3,
      current: 2,
      retainedUnverified: 1,
      stale: 0,
      privateCount: 2,
      archived: 0,
    });
    expect(body.inventory.status).toBe("partial");
    expect(body.inventory.errorCode).toBe("rate_limited");
    const issue = body.workScopes.find(
      (s: { sourceType: string }) => s.sourceType === "issue",
    );
    expect(issue.label).toBe("populated");
    expect(issue.retainedRowCount).toBe(4);
    const agents = body.workScopes.find(
      (s: { sourceType: string }) => s.sourceType === "agents",
    );
    expect(agents.label).toBe("unsupported");
    expect(agents.errorCodes.source_unavailable).toBe(1);
    expect(body.queues.queues.attention).toEqual([]);
  });

  test("an empty corpus is explicit and skips the queue derivation", async () => {
    mockProjectCount.mockResolvedValue(0);
    mockProjectGroupBy.mockResolvedValue([]);
    mockWorkResourceGroupBy.mockResolvedValue([]);
    mockSyncStateFindMany.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emptyCorpus).toBe(true);
    expect(body.corpus.total).toBe(0);
    expect(mockLoadWorkQueues).not.toHaveBeenCalled();
  });

  test("database failure degrades to a 503 without leaking provider errors", async () => {
    mockProjectCount.mockRejectedValue(new Error("database down"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Portfolio summary is temporarily unavailable.");
  });
});
