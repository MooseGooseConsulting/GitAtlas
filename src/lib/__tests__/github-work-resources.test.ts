import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockResourceUpsert,
  mockResourceFindMany,
  mockResourceFindUnique,
  mockReferenceUpsert,
  mockSyncStateUpsert,
  mockSyncStateFindUnique,
  mockTransaction,
} = vi.hoisted(() => {
  const mockResourceUpsert = vi.fn();
  const mockResourceFindMany = vi.fn();
  const mockResourceFindUnique = vi.fn();
  const mockReferenceUpsert = vi.fn();
  const mockSyncStateUpsert = vi.fn();
  const mockSyncStateFindUnique = vi.fn();
  const mockTransaction = vi.fn((callback: (tx: unknown) => unknown) =>
    callback({
      workResource: {
        upsert: mockResourceUpsert,
        findMany: mockResourceFindMany,
        findUnique: mockResourceFindUnique,
      },
      workReference: { upsert: mockReferenceUpsert },
    }),
  );
  return {
    mockResourceUpsert,
    mockResourceFindMany,
    mockResourceFindUnique,
    mockReferenceUpsert,
    mockSyncStateUpsert,
    mockSyncStateFindUnique,
    mockTransaction,
  };
});

vi.mock("../db", () => ({
  db: {
    workResource: {
      upsert: mockResourceUpsert,
      findMany: mockResourceFindMany,
      findUnique: mockResourceFindUnique,
    },
    workReference: { upsert: mockReferenceUpsert },
    syncState: {
      upsert: mockSyncStateUpsert,
      findUnique: mockSyncStateFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

import {
  extractWorkReferences,
  GithubWorkResourceError,
  syncProjectWorkResources,
} from "../github-work-resources";
import { fetchPages } from "../github-work-resource-client";

const project = {
  id: "project-row",
  githubId: 777,
  ownerLogin: "Owner",
  name: "repo",
  htmlUrl: "https://github.com/Owner/repo",
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  process.env.GITHUB_READ_TOKEN_GITATLAS = "test-token";
  mockResourceUpsert.mockReset().mockResolvedValue({});
  mockResourceFindMany.mockReset().mockResolvedValue([]);
  mockResourceFindUnique.mockReset().mockResolvedValue({ id: "source-row" });
  mockReferenceUpsert.mockReset().mockResolvedValue({});
  mockSyncStateUpsert.mockReset().mockResolvedValue({});
  mockSyncStateFindUnique.mockReset().mockResolvedValue(null);
  mockTransaction.mockClear();
});

afterEach(() => {
  delete process.env.GITHUB_READ_TOKEN_GITATLAS;
});

describe("work-resource references", () => {
  test.each([
    [
      "another origin",
      "https://evil.example/repositories/777/issues?per_page=100&page=2",
    ],
    [
      "another repository",
      "https://api.github.com/repositories/778/issues?per_page=100&page=2",
    ],
    [
      "another collection",
      "https://api.github.com/repositories/777/pulls?per_page=100&page=2",
    ],
    [
      "a different page size",
      "https://api.github.com/repositories/777/issues?per_page=50&page=2",
    ],
  ])("rejects pagination links for %s", async (_case, url) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ id: 100, title: "Fetched page" }], {
        link: `<${url}>; rel="next"`,
      }),
    );

    await expect(
      fetchPages("/repos/Owner/repo/issues?state=all", fetchImpl, undefined, 777),
    ).rejects.toMatchObject({
      code: "invalid_pagination",
      pagesFetched: 1,
      fetchedItems: [{ id: 100, title: "Fetched page" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("keeps explicit GitHub links separate from inferred mentions", () => {
    expect(
      extractWorkReferences(
        "See https://github.com/Owner/repo/pull/7 and also #8.",
        "Owner",
        "repo",
      ),
    ).toEqual([
      {
        targetNumber: 7,
        targetSourceType: "pull_request",
        targetUrl: "https://github.com/Owner/repo/pull/7",
        relationshipType: "explicit",
        evidence: "source_url",
        intent: "reference",
      },
      {
        targetNumber: 8,
        targetSourceType: null,
        targetUrl: null,
        relationshipType: "inferred",
        evidence: "text_mention",
        intent: "reference",
      },
    ]);
  });

  test("records closing and blocking intent without changing referenced state", () => {
    expect(
      extractWorkReferences(
        "Fixes #12\nBlocked by https://github.com/Owner/repo/issues/3",
        "Owner",
        "repo",
      ),
    ).toEqual([
      {
        targetNumber: 3,
        targetSourceType: "issue",
        targetUrl: "https://github.com/Owner/repo/issues/3",
        relationshipType: "explicit",
        evidence: "source_url",
        intent: "blocking",
      },
      {
        targetNumber: 12,
        targetSourceType: null,
        targetUrl: null,
        relationshipType: "inferred",
        evidence: "text_mention",
        intent: "closing",
      },
    ]);
  });

  test("persists stable source IDs, timestamps, URLs, and only adds reference evidence", async () => {
    mockResourceFindMany.mockResolvedValue([
      {
        id: "target-row",
        externalId: "102",
        issueNumber: 6,
        sourceUrl: "https://github.com/Owner/repo/issues/6",
        sourceType: "issue",
      },
    ]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issues")) {
        if (url.searchParams.get("page") === "2") {
          return jsonResponse([
            {
              id: 102,
              number: 6,
              title: "Referenced issue",
              state: "open",
              html_url: "https://github.com/Owner/repo/issues/6",
              created_at: "2026-09-02T00:00:00Z",
            },
          ]);
        }
        return jsonResponse([
          {
            id: 101,
            number: 5,
            title: "Closed source issue",
            body: "This merely mentions #6",
            state: "closed",
            html_url: "https://github.com/Owner/repo/issues/5",
            created_at: "2026-09-01T00:00:00Z",
            updated_at: "2026-09-02T00:00:00Z",
            closed_at: "2026-09-03T00:00:00Z",
          },
        ], {
          link: '<https://api.github.com/repositories/777/issues?state=all&per_page=100&page=2>; rel="next"',
        });
      }
      if (url.pathname.endsWith("/pulls")) {
        if (url.searchParams.get("page") === "2") {
          return jsonResponse([
            {
              id: 202,
              number: 8,
              title: "Second pull request",
              state: "closed",
              merged_at: "2026-09-06T00:00:00Z",
              created_at: "2026-09-03T00:00:00Z",
              updated_at: "2026-09-06T00:00:00Z",
              html_url: "https://github.com/Owner/repo/pull/8",
              pull_request: {
                html_url: "https://github.com/Owner/repo/pull/8",
              },
            },
          ]);
        }
        return jsonResponse([
          {
            id: 201,
            number: 7,
            title: "A linked pull request",
            body: "References https://github.com/Owner/repo/issues/5",
            state: "open",
            created_at: "2026-09-03T00:00:00Z",
            updated_at: "2026-09-04T00:00:00Z",
            html_url: "https://github.com/Owner/repo/pull/7",
            pull_request: {
              html_url: "https://github.com/Owner/repo/pull/7",
            },
          },
        ], {
          link: '<https://api.github.com/repositories/777/pulls?state=all&per_page=100&page=2>; rel="next"',
        });
      }
      if (url.pathname.endsWith("/branches")) {
        return jsonResponse([
          {
            name: "main",
            commit: {
              sha: "abc123",
              commit: { committer: { date: "2026-09-04T00:00:00Z" } },
            },
          },
        ]);
      }
      if (url.pathname.endsWith("/commits")) {
        return jsonResponse([
          {
            sha: "abc123",
            html_url: "https://github.com/Owner/repo/commit/abc123",
            commit: {
              message: "Change",
              author: { date: "2026-09-04T00:00:00Z" },
              committer: { date: "2026-09-05T00:00:00Z" },
            },
          },
        ]);
      }
      if (url.pathname.endsWith("/statuses")) {
        return jsonResponse([{ state: "success", created_at: "2026-09-06T00:00:00Z" }]);
      }
      return jsonResponse([
        {
          id: 901,
          environment: "production",
          ref: "main",
          created_at: "2026-09-05T00:00:00Z",
          url: "https://api.github.com/repos/Owner/repo/deployments/901",
        },
      ]);
    });

    const result = await syncProjectWorkResources(project, {
      fetchImpl,
      fetchedAt: new Date("2026-09-30T00:00:00Z"),
    });

    expect(result.issues.count).toBe(2);
    expect(result.issues.pages).toBe(2);
    expect(result.pullRequests.count).toBe(2);
    expect(result.pullRequests.pages).toBe(2);
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "issue",
            externalId: "101",
          },
        },
        create: expect.objectContaining({
          issueNumber: 5,
          sourceUrl: "https://github.com/Owner/repo/issues/5",
          sourceState: "closed",
          sourceClosedAt: new Date("2026-09-03T00:00:00Z"),
        }),
      }),
    );
    expect(mockReferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          targetResourceId: "target-row",
          targetSourceType: "issue",
          targetExternalId: "number:6",
          targetUrl: "https://github.com/Owner/repo/issues/6",
          relationshipType: "inferred",
          evidence: "text_mention",
          category: "source_supported_inference",
          confidence: "supported",
          intent: "reference",
        }),
      }),
    );
    expect(mockReferenceUpsert.mock.calls[0][0]).not.toHaveProperty("sourceState");
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "pull_request",
            externalId: "201",
          },
        },
        create: expect.objectContaining({
          issueNumber: 7,
          sourceUrl: "https://github.com/Owner/repo/pull/7",
          sourceState: "open",
        }),
      }),
    );
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "branch",
            externalId: "main",
          },
        },
        create: expect.objectContaining({
          sourceUpdatedAt: new Date("2026-09-04T00:00:00Z"),
        }),
      }),
    );
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "commit",
            externalId: "abc123",
          },
        },
        create: expect.objectContaining({
          title: "Change",
          sourceUpdatedAt: new Date("2026-09-05T00:00:00Z"),
        }),
      }),
    );
    expect(mockReferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          targetExternalId: "issue:5",
          targetSourceType: "issue",
          targetUrl: "https://github.com/Owner/repo/issues/5",
          relationshipType: "explicit",
          evidence: "source_url",
          category: "explicit_github_link",
          confidence: "authoritative",
          intent: "reference",
        }),
      }),
    );
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "deployment",
            externalId: "901",
          },
        },
        create: expect.objectContaining({
          sourceUrl:
            "https://api.github.com/repos/Owner/repo/deployments/901",
          sourceState: "success",
          sourceUpdatedAt: new Date("2026-09-06T00:00:00Z"),
        }),
      }),
    );
    expect(mockSyncStateUpsert.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            create: expect.objectContaining({
              scope: "github:work-resources:777:agents",
              status: "unsupported",
              itemCount: 0,
            }),
          }),
        ],
        [
          expect.objectContaining({
            create: expect.objectContaining({
              scope: "github:work-resources:777:services",
              status: "unsupported",
              unsupportedCount: 1,
            }),
          }),
        ],
      ]),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  test("persists the real GitHub pull_request head ref so matching deployment success can qualify readiness", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/statuses")) {
        return jsonResponse([
          { state: "success", created_at: "2026-09-29T12:00:00Z" },
        ]);
      }
      if (url.pathname.endsWith("/pulls")) {
        return jsonResponse([
          {
            id: 501,
            number: 21,
            title: "Add landing evidence",
            state: "open",
            created_at: "2026-09-20T00:00:00Z",
            updated_at: "2026-09-28T00:00:00Z",
            html_url: "https://github.com/Owner/repo/pull/21",
            head: { ref: "feature-x", sha: "abc123" },
            base: { ref: "main" },
            labels: [],
            requested_reviewers: [],
          },
        ]);
      }
      if (url.pathname.endsWith("/deployments")) {
        return jsonResponse([
          {
            id: 601,
            environment: "production",
            ref: "feature-x",
            created_at: "2026-09-29T00:00:00Z",
            url: "https://api.github.com/repos/Owner/repo/deployments/601",
          },
        ]);
      }
      return new Response("", { status: 404 });
    });

    const result = await syncProjectWorkResources(project, {
      fetchImpl,
      fetchedAt: new Date("2026-09-30T00:00:00Z"),
    });

    expect(result.pullRequests.count).toBe(1);
    expect(result.deployments.count).toBe(1);
    const prCall = mockResourceUpsert.mock.calls.find(
      ([call]) =>
        call.where.projectId_sourceType_externalId.sourceType ===
          "pull_request" && call.where.projectId_sourceType_externalId.externalId === "501",
    );
    expect(prCall).toBeDefined();
    expect(prCall![0].create).toEqual(
      expect.objectContaining({
        sourceState: "open",
        refName: "feature-x",
        sourceUrl: "https://github.com/Owner/repo/pull/21",
      }),
    );
    expect(prCall![0].update).toEqual(
      expect.objectContaining({ refName: "feature-x" }),
    );
    const deploymentCall = mockResourceUpsert.mock.calls.find(
      ([call]) =>
        call.where.projectId_sourceType_externalId.sourceType === "deployment",
    );
    expect(deploymentCall).toBeDefined();
    expect(deploymentCall![0].create).toEqual(
      expect.objectContaining({
        sourceState: "success",
        refName: "feature-x",
      }),
    );
  });

  test("a pull request payload without a head ref persists refName as null instead of guessing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pulls")) {
        return jsonResponse([
          {
            id: 502,
            number: 22,
            title: "Payload without head ref",
            state: "open",
            created_at: "2026-09-20T00:00:00Z",
            updated_at: "2026-09-28T00:00:00Z",
            html_url: "https://github.com/Owner/repo/pull/22",
          },
        ]);
      }
      return new Response("", { status: 404 });
    });

    const result = await syncProjectWorkResources(project, {
      fetchImpl,
      fetchedAt: new Date("2026-09-30T00:00:00Z"),
    });

    expect(result.pullRequests.count).toBe(1);
    const prCall = mockResourceUpsert.mock.calls.find(
      ([call]) =>
        call.where.projectId_sourceType_externalId.sourceType ===
        "pull_request",
    );
    expect(prCall).toBeDefined();
    expect(prCall![0].create).toEqual(
      expect.objectContaining({ refName: null }),
    );
  });

  test("marks an unavailable scope unsupported instead of recording zero as current", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const result = await syncProjectWorkResources(project, { fetchImpl });

    expect(result.issues).toEqual({ count: 0, pages: 0, unsupported: true });
    expect(mockResourceUpsert).not.toHaveBeenCalled();
    expect(mockSyncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scope: "github:work-resources:777:issue",
          status: "unsupported",
          errorCode: "scope_unsupported",
          itemCount: 0,
        }),
      }),
    );
  });

  test("retains rows and marks a failed later page partial", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{
          id: 103,
          number: 9,
          title: "Page one issue",
          state: "open",
          html_url: "https://github.com/Owner/repo/issues/9",
        }], {
          link: '<https://api.github.com/repositories/777/issues?state=all&per_page=100&page=2>; rel="next"',
        }),
      )
      .mockResolvedValue(new Response("", { status: 502 }));
    mockSyncStateFindUnique.mockResolvedValue({
      lastSuccessAt: new Date("2026-09-01T00:00:00Z"),
      itemCount: 2,
    });

    await expect(syncProjectWorkResources(project, { fetchImpl })).rejects.toBeInstanceOf(
      GithubWorkResourceError,
    );
    expect(mockResourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: "issue",
            externalId: "103",
          },
        },
        create: expect.objectContaining({
          title: "Page one issue",
          sourceUrl: "https://github.com/Owner/repo/issues/9",
        }),
      }),
    );
    expect(mockSyncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "partial",
          lastSuccessAt: new Date("2026-09-01T00:00:00Z"),
          itemCount: 2,
          errorCode: "provider_failure",
        }),
      }),
    );
    expect(mockSyncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scope: "github:work-resources:777:pull_request",
          status: "unattempted",
          itemCount: 0,
          errorCode: "not_attempted",
        }),
      }),
    );
    expect(mockSyncStateUpsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scope: "github:work-resources:777:pull_request",
          status: "unsupported",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test("respects a stored resource rate-limit cooldown without calling GitHub", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    const fetchImpl = vi.fn();
    mockSyncStateFindUnique.mockResolvedValue({
      retryAt,
      lastSuccessAt: new Date("2026-09-01T00:00:00Z"),
      itemCount: 3,
    });

    await expect(
      syncProjectWorkResources(project, { fetchImpl }),
    ).rejects.toMatchObject({ code: "rate_limited" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockSyncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "deferred",
          retryAt,
          itemCount: 3,
          lastSuccessAt: new Date("2026-09-01T00:00:00Z"),
        }),
      }),
    );
  });
});
