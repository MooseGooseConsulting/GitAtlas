import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const originalInternalToken = process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
const {
  mockProjectFindUnique,
  mockProjectFindMany,
  mockProjectCount,
  mockResourceFindMany,
  mockSyncStateFindUnique,
  mockSync,
} =
  vi.hoisted(() => ({
    mockProjectFindUnique: vi.fn(),
    mockProjectFindMany: vi.fn(),
    mockProjectCount: vi.fn(),
    mockResourceFindMany: vi.fn(),
    mockSyncStateFindUnique: vi.fn(),
    mockSync: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  db: {
    project: {
      findUnique: mockProjectFindUnique,
      findMany: mockProjectFindMany,
      count: mockProjectCount,
    },
    workResource: { findMany: mockResourceFindMany },
    syncState: { findUnique: mockSyncStateFindUnique },
  },
}));

vi.mock("@/lib/github-work-resources", () => ({
  getWorkResourceScope: (_project: { githubId: number }, type: string) =>
    `github:work-resources:77:${type}`,
  syncProjectWorkResources: mockSync,
}));

import { GET, POST } from "../route";

const project = {
  id: "project-row",
  githubId: 77,
  ownerLogin: "owner",
  name: "repo",
  htmlUrl: "https://github.com/owner/repo",
};

beforeEach(() => {
  delete process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  mockProjectFindUnique.mockReset().mockResolvedValue({
    id: project.id,
    githubId: project.githubId,
    fullName: "owner/repo",
    inventoryStatus: "current",
  });
  mockProjectFindMany.mockReset().mockResolvedValue([project]);
  mockProjectCount.mockReset().mockResolvedValue(1);
  mockResourceFindMany.mockReset().mockResolvedValue([
    {
      id: "resource",
      sourceType: "pull_request",
      externalId: "pr-id",
      sourceState: "open",
      sourceUrl: "https://github.com/owner/repo/pull/9",
      references: [
        {
          targetExternalId: "issue-id",
          targetUrl: "https://github.com/owner/repo/issues/4",
          relationshipType: "explicit",
          evidence: "source_url",
        },
      ],
    },
  ]);
  mockSyncStateFindUnique.mockResolvedValue(null);
  mockSync.mockReset().mockResolvedValue({
    issues: { count: 1, pages: 1, unsupported: false },
    pullRequests: { count: 1, pages: 1, unsupported: false },
    branches: { count: 0, pages: 1, unsupported: false },
    commits: { count: 0, pages: 1, unsupported: false },
    deployments: { count: 0, pages: 1, unsupported: false },
  });
});

afterEach(() => {
  if (originalInternalToken === undefined) {
    delete process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  } else {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = originalInternalToken;
  }
  vi.restoreAllMocks();
});

describe("work resources API", () => {
  test("reads persisted source links and explicit relationship provenance", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/work/resources?project=77"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.resources[0]).toMatchObject({
      sourceType: "pull_request",
      sourceState: "open",
      sourceUrl: "https://github.com/owner/repo/pull/9",
      references: [{ relationshipType: "explicit", evidence: "source_url" }],
    });
    expect(payload.unsupported).toMatchObject({
      agents: { status: "unsupported" },
      services: { status: "unsupported" },
    });
  });

  test("rejects unauthorized sync before looking up a worker target", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/work/resources", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(mockProjectFindMany).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  test("authorized sync uses only persisted projects, not request-supplied targets", async () => {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "test-internal-token";
    const response = await POST(
      new NextRequest("http://localhost/api/work/resources", {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token" },
        body: JSON.stringify({ url: "http://127.0.0.1:9999", project: 999 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "partial",
      projectCount: 1,
      attemptedProjectCount: 1,
      syncedProjectCount: 1,
      skippedProjectCount: 0,
      failedProjectCount: 0,
      unsupportedScopeCount: 2,
      resourceCount: 2,
      pagesFetched: 5,
    });
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inventoryStatus: "current" },
      }),
    );
    expect(mockSync).toHaveBeenCalledWith(project);
  });

  test("continues after a project error and reports partial unsupported coverage", async () => {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "test-internal-token";
    const projects = [
      project,
      { ...project, id: "project-row-2", githubId: 78, name: "repo-2" },
    ];
    mockProjectFindMany.mockResolvedValue(projects);
    mockProjectCount.mockResolvedValue(2);
    mockSync
      .mockRejectedValueOnce(
        Object.assign(new Error("safe generic failure"), {
          code: "provider_failure",
          pagesFetched: 1,
        }),
      )
      .mockResolvedValueOnce({
        issues: { count: 0, pages: 1, unsupported: true },
        pullRequests: { count: 1, pages: 1, unsupported: false },
        branches: { count: 0, pages: 1, unsupported: false },
        commits: { count: 0, pages: 1, unsupported: false },
        deployments: { count: 0, pages: 1, unsupported: false },
      });

    const response = await POST(
      new NextRequest("http://localhost/api/work/resources", {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "partial",
      projectCount: 2,
      attemptedProjectCount: 2,
      syncedProjectCount: 1,
      skippedProjectCount: 0,
      failedProjectCount: 1,
      failedScopeCount: 1,
      unsupportedScopeCount: 5,
      resourceCount: 1,
      pagesFetched: 6,
      failureCodes: { provider_failure: 1 },
    });
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  test("does not report current when projects are excluded from the sync scope", async () => {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "test-internal-token";
    mockProjectCount.mockResolvedValue(2);

    const response = await POST(
      new NextRequest("http://localhost/api/work/resources", {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "partial",
      projectCount: 2,
      attemptedProjectCount: 1,
      syncedProjectCount: 1,
      skippedProjectCount: 1,
      unsupportedScopeCount: 2,
    });
  });
});
