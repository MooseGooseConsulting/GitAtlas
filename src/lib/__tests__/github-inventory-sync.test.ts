import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GithubInventoryError } from "../github-inventory";

const {
  mockProjectUpsert,
  mockProjectUpdateMany,
  mockProjectFindMany,
  mockHeadFetch,
  mockSyncStateUpsert,
  mockSyncStateUpdate,
  mockSyncStateFindUnique,
  mockTransaction,
} =
  vi.hoisted(() => {
    const mockProjectUpsert = vi.fn();
    const mockProjectUpdateMany = vi.fn();
    const mockProjectFindMany = vi.fn();
    const mockHeadFetch = vi.fn();
    const mockSyncStateUpsert = vi.fn();
    const mockSyncStateUpdate = vi.fn();
    const mockSyncStateFindUnique = vi.fn();
    const mockTransaction = vi.fn((callback: (tx: unknown) => unknown) =>
      callback({
        project: {
          upsert: mockProjectUpsert,
          updateMany: mockProjectUpdateMany,
        },
        syncState: {
          update: mockSyncStateUpdate,
          upsert: mockSyncStateUpsert,
        },
      }),
    );
    return {
      mockProjectUpsert,
      mockProjectUpdateMany,
      mockProjectFindMany,
      mockHeadFetch,
      mockSyncStateUpsert,
      mockSyncStateUpdate,
      mockSyncStateFindUnique,
      mockTransaction,
    };
  });

vi.mock("../db", () => ({
  db: {
    project: {
      upsert: mockProjectUpsert,
      updateMany: mockProjectUpdateMany,
      findMany: mockProjectFindMany,
    },
    syncState: {
      upsert: mockSyncStateUpsert,
      update: mockSyncStateUpdate,
      findUnique: mockSyncStateFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("../github-inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../github-inventory")>();
  return {
    ...actual,
    fetchAccessibleRepositories: vi.fn(),
    fetchDefaultBranchHeadSha: mockHeadFetch,
  };
});

const { fetchAccessibleRepositories } = await import("../github-inventory");
const { refreshAccessibleInventory } = await import("../github-inventory-sync");
const fetchInventoryMock = vi.mocked(fetchAccessibleRepositories);

const repo = {
  id: 777,
  name: "inventory",
  full_name: "owner/inventory",
  description: "Description",
  html_url: "https://github.com/owner/inventory",
  private: true,
  visibility: "private",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  pushed_at: "2026-09-02T00:00:00.000Z",
  default_branch: "trunk",
  owner: { login: "owner", type: "Organization" },
};

beforeEach(() => {
  mockProjectUpsert.mockReset().mockResolvedValue({});
  mockProjectUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockProjectFindMany.mockReset().mockResolvedValue([]);
  mockHeadFetch.mockReset().mockResolvedValue({
    sha: "0123456789abcdef",
    unsupported: false,
  });
  mockSyncStateUpsert.mockReset().mockResolvedValue({});
  mockSyncStateUpsert.mockReset().mockResolvedValue({});
  mockSyncStateUpdate.mockReset().mockResolvedValue({});
  mockSyncStateFindUnique.mockReset().mockResolvedValue({
    lastSuccessAt: new Date("2026-09-01T00:00:00.000Z"),
    itemCount: 1,
  });
  mockTransaction.mockClear();
  fetchInventoryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshAccessibleInventory", () => {
  test("upserts project by stable GitHub ID and preserves observed private metadata", async () => {
    const fetchedAt = new Date("2026-09-30T00:00:00.000Z");
    fetchInventoryMock.mockResolvedValue({
      repositories: [{ ...repo }],
      pagesFetched: 1,
      fetchedAt,
    });

    const result = await refreshAccessibleInventory();
    const [call] = mockProjectUpsert.mock.calls;

    expect(mockProjectUpsert).toHaveBeenCalledTimes(1);
    expect(call[0]).toMatchObject({
      where: { githubId: 777 },
      create: {
        githubId: 777,
        ownerLogin: "owner",
        visibility: "private",
        defaultBranch: "trunk",
      },
      update: {
        fullName: "owner/inventory",
        isArchived: false,
        visibility: "private",
        defaultBranchHeadSha: "0123456789abcdef",
      },
    });
    expect(result).toMatchObject({
      status: "current",
      itemCount: 1,
      pagesFetched: 1,
    });
    expect(mockSyncStateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope: "github:accessible-repositories" },
      data: expect.objectContaining({ lastSuccessAt: fetchedAt }),
    }));
    expect(mockProjectUpdateMany).toHaveBeenCalledWith({
      where: {
        githubId: { notIn: [777] },
        inventoryStatus: { not: "unverified" },
      },
      data: {
        inventoryStatus: "stale",
        inventoryFetchedAt: fetchedAt,
      },
    });
  });

  test("unchanged refresh does not create duplicates and uses the same identity", async () => {
    fetchInventoryMock.mockResolvedValue({
      repositories: [{ ...repo }],
      pagesFetched: 1,
      fetchedAt: new Date("2026-09-30T00:00:00.000Z"),
    });

    await refreshAccessibleInventory();
    await refreshAccessibleInventory();

    expect(mockProjectUpsert).toHaveBeenCalledTimes(2);
    expect(mockProjectUpsert.mock.calls.map(([call]) => call.where.githubId)).toEqual([
      777,
      777,
    ]);
    expect(mockProjectUpsert.mock.calls[0][0].update).toEqual(
      mockProjectUpsert.mock.calls[1][0].update,
    );
  });

  test("failed later page marks partial without advancing last success or overwriting projects", async () => {
    fetchInventoryMock.mockRejectedValue(
      new GithubInventoryError({
        status: 502,
        code: "provider_failure",
        pagesFetched: 1,
      }),
    );

    await expect(refreshAccessibleInventory()).rejects.toMatchObject({
      code: "provider_failure",
    });

    expect(mockProjectUpsert).not.toHaveBeenCalled();
    expect(mockSyncStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: "partial",
        pagesFetched: 1,
        errorCode: "provider_failure",
      }),
    }));
    expect(mockSyncStateUpsert.mock.calls.at(-1)?.[0].update).not.toHaveProperty(
      "lastSuccessAt",
    );
  });

  test("unchanged default branch skips head fetch and preserves prior analysis", async () => {
    mockProjectFindMany.mockResolvedValue([{
      githubId: 777,
      defaultBranch: "trunk",
      defaultBranchHeadSha: "oldsha",
      githubUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
      pushedAt: new Date("2026-09-02T00:00:00.000Z"),
    }]);
    fetchInventoryMock.mockResolvedValue({
      repositories: [{ ...repo }],
      pagesFetched: 1,
      fetchedAt: new Date("2026-09-30T00:00:00.000Z"),
    });

    await refreshAccessibleInventory();

    expect(mockHeadFetch).not.toHaveBeenCalled();
    expect(mockProjectUpsert.mock.calls[0][0].update).toMatchObject({
      defaultBranchHeadSha: "oldsha",
    });
    expect(mockProjectUpsert.mock.calls[0][0].update).not.toHaveProperty(
      "analyzedAt",
    );
  });

  test("changed repository revision updates stable row and clears stale analyses", async () => {
    mockProjectFindMany.mockResolvedValue([{
      githubId: 777,
      defaultBranch: "main",
      defaultBranchHeadSha: "oldsha",
      githubUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
      pushedAt: new Date("2026-08-01T00:00:00.000Z"),
    }]);
    mockHeadFetch.mockResolvedValue({
      sha: "newsha",
      unsupported: false,
    });
    fetchInventoryMock.mockResolvedValue({
      repositories: [{ ...repo }],
      pagesFetched: 1,
      fetchedAt: new Date("2026-09-30T00:00:00.000Z"),
    });

    await refreshAccessibleInventory();

    expect(mockProjectUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubId: 777 },
        update: expect.objectContaining({
          fullName: "owner/inventory",
          defaultBranchHeadSha: "newsha",
          analyzedAt: null,
          deepAnalyzedAt: null,
        }),
      }),
    );
    expect(mockHeadFetch).toHaveBeenCalledWith("owner/inventory", "trunk");
  });

  test("rate-limit state records deferral time and retains existing data", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fetchInventoryMock.mockRejectedValue(
      new GithubInventoryError({
        status: 429,
        code: "rate_limited",
        retryAt: retryAt.toISOString(),
      }),
    );

    await expect(refreshAccessibleInventory()).rejects.toMatchObject({
      status: 429,
    });

    expect(mockProjectUpsert).not.toHaveBeenCalled();
    expect(mockSyncStateUpsert.mock.calls.at(-1)?.[0].update).toMatchObject({
      status: "deferred",
      retryAt,
      errorCode: "rate_limited",
    });
  });

  test("stored rate-limit cooldown prevents another provider request", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    mockSyncStateFindUnique.mockResolvedValue({
      retryAt,
      lastSuccessAt: new Date("2026-09-01T00:00:00.000Z"),
      itemCount: 1,
    });

    await expect(refreshAccessibleInventory()).rejects.toMatchObject({
      status: 429,
      retryAt: retryAt.toISOString(),
    });

    expect(fetchInventoryMock).not.toHaveBeenCalled();
    expect(mockSyncStateUpsert).not.toHaveBeenCalled();
  });

  test("head-scope cooldown keeps repository inventory and defers head requests", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    mockSyncStateFindUnique.mockImplementation(
      ({ where }: { where: { scope: string } }) =>
        Promise.resolve(
          where.scope === "github:default-branch-heads"
            ? { retryAt }
            : { retryAt: null },
        ),
    );
    fetchInventoryMock.mockResolvedValue({
      repositories: [{ ...repo }],
      pagesFetched: 1,
      fetchedAt: new Date(),
    });

    const result = await refreshAccessibleInventory();

    expect(result.status).toBe("current");
    expect(result.headStatus).toBe("deferred");
    expect(mockHeadFetch).not.toHaveBeenCalled();
    expect(mockProjectUpsert).toHaveBeenCalledTimes(1);
    expect(mockSyncStateUpsert.mock.calls.at(-1)?.[0].create).toMatchObject({
      scope: "github:default-branch-heads",
      status: "deferred",
      retryAt,
    });
  });
});
