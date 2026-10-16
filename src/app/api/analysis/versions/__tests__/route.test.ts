import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockProjectFindUnique, mockAnalysisFindMany } = vi.hoisted(() => ({
  mockProjectFindUnique: vi.fn(),
  mockAnalysisFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: mockProjectFindUnique },
    repositoryAnalysis: { findMany: mockAnalysisFindMany },
  },
}));

const { GET } = await import("../route");

function makeRequest(projectParam?: string) {
  const url = projectParam === undefined
    ? "http://localhost/api/analysis/versions"
    : `http://localhost/api/analysis/versions?project=${projectParam}`;
  return new NextRequest(url);
}

const project = {
  id: "p-1",
  githubId: 123,
  fullName: "o/repo",
  defaultBranch: "main",
  defaultBranchHeadSha: "sha-new",
};

beforeEach(() => {
  mockProjectFindUnique.mockReset().mockResolvedValue(project);
  mockAnalysisFindMany.mockReset().mockResolvedValue([
    {
      id: "a-1",
      status: "completed",
      analyzedSha: "sha-old",
      promptVersion: "repository-analysis-v1",
      model: "google/gemma-4-26b-a4b-it:free",
      errorCode: null,
      retryAt: null,
      samplingBoundary: "readme+metadata",
      createdAt: new Date("2026-09-29T10:00:00.000Z"),
      completedAt: new Date("2026-09-29T10:05:00.000Z"),
    },
    {
      id: "a-2",
      status: "pending",
      analyzedSha: null,
      promptVersion: "repository-analysis-v1",
      model: "google/gemma-4-26b-a4b-it:free",
      errorCode: "free_quota_exhausted",
      retryAt: new Date("2026-09-30T13:00:00.000Z"),
      samplingBoundary: "readme+metadata",
      createdAt: new Date("2026-09-30T12:00:00.000Z"),
      completedAt: null,
    },
  ]);
});

describe("GET /api/analysis/versions", () => {
  test("returns project head and versions with computed revision state", async () => {
    const response = await GET(makeRequest("123"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project).toEqual({
      githubId: 123,
      fullName: "o/repo",
      defaultBranch: "main",
      headSha: "sha-new",
    });
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0]).toMatchObject({
      id: "a-1",
      status: "completed",
      state: "completed_stale",
      stale: true,
    });
    expect(body.versions[1]).toMatchObject({
      id: "a-2",
      status: "pending",
      state: "pending",
      stale: false,
      errorCode: "free_quota_exhausted",
    });
  });

  test("rejects a missing or invalid project parameter", async () => {
    expect((await GET(makeRequest())).status).toBe(400);
    expect((await GET(makeRequest("abc"))).status).toBe(400);
    expect((await GET(makeRequest("-5"))).status).toBe(400);
  });

  test("returns 404 for an unknown project", async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const response = await GET(makeRequest("999"));
    expect(response.status).toBe(404);
  });

  test("returns 503 when the database is unavailable", async () => {
    mockProjectFindUnique.mockRejectedValue(new Error("down"));
    const response = await GET(makeRequest("123"));
    expect(response.status).toBe(503);
  });
});
