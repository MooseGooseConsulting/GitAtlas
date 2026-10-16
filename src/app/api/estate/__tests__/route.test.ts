import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockEstateFindFirst,
  mockProjectFindMany,
  mockAnalysisFindMany,
  mockRunEstateSynthesis,
} = vi.hoisted(() => ({
  mockEstateFindFirst: vi.fn(),
  mockProjectFindMany: vi.fn(),
  mockAnalysisFindMany: vi.fn(),
  mockRunEstateSynthesis: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    estateAnalysis: { findFirst: mockEstateFindFirst },
    project: { findMany: mockProjectFindMany },
    repositoryAnalysis: { findMany: mockAnalysisFindMany },
  },
}));

vi.mock("@/lib/estate-synthesis", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/estate-synthesis")
  >("@/lib/estate-synthesis");
  return {
    ...actual,
    runEstateSynthesis: mockRunEstateSynthesis,
  };
});

const { GET } = await import("../route");
const { POST } = await import("../../estate/synthesize/route");
const originalToken = process.env.GITATLAS_INTERNAL_SYNC_TOKEN;

const projects = [
  { id: "p-done", fullName: "o/done", isArchived: false, defaultBranchHeadSha: "sha-1" },
  { id: "p-pending", fullName: "o/pending", isArchived: false, defaultBranchHeadSha: "sha-2" },
  { id: "p-new", fullName: "o/new", isArchived: false, defaultBranchHeadSha: null },
];

const analyses = [
  {
    id: "a-done",
    projectId: "p-done",
    status: "completed",
    analyzedSha: "sha-1",
    promptVersion: "repository-analysis-v1",
    model: "google/gemma-4-26b-a4b-it:free",
    errorCode: null,
    retryAt: null,
    completedAt: new Date("2026-09-29T10:00:00.000Z"),
    createdAt: new Date("2026-09-29T09:00:00.000Z"),
    resultJson: null,
  },
  {
    id: "a-pending",
    projectId: "p-pending",
    status: "pending",
    analyzedSha: "sha-2",
    promptVersion: "repository-analysis-v1",
    model: "google/gemma-4-26b-a4b-it:free",
    errorCode: "free_quota_exhausted",
    retryAt: new Date("2026-09-30T13:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2026-09-30T12:00:00.000Z"),
    resultJson: null,
  },
];

beforeEach(() => {
  process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "test-token";
  mockEstateFindFirst.mockReset().mockResolvedValue({
    id: "estate-1",
    inputHash: "hash",
    promptVersion: "estate-synthesis-v1",
    model: "google/gemma-4-26b-a4b-it:free",
    analysisVersionIds: JSON.stringify(["a-done"]),
    coverageJson: "{}",
    resultJson: JSON.stringify({
      narrative: "Sampled estate.",
      themes: [],
      uncertainties: ["Coverage is partial."],
    }),
    status: "completed",
    errorCode: null,
    retryAt: null,
    createdAt: new Date("2026-09-30T12:30:00.000Z"),
    completedAt: new Date("2026-09-30T12:30:00.000Z"),
    updatedAt: new Date("2026-09-30T12:30:00.000Z"),
  });
  mockProjectFindMany.mockReset().mockResolvedValue(projects);
  mockAnalysisFindMany.mockReset().mockImplementation((args) => {
    const idFilter = args?.where?.id?.in as string[] | undefined;
    if (idFilter) {
      return Promise.resolve(
        analyses.filter((analysis) => idFilter.includes(analysis.id)),
      );
    }
    return Promise.resolve(analyses);
  });
  mockRunEstateSynthesis.mockReset().mockResolvedValue({
    status: "pending",
    estateId: "estate-2",
    errorCode: "free_quota_exhausted",
    retryAt: "2026-09-30T13:00:00.000Z",
  });
});

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  } else {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = originalToken;
  }
});

describe("GET /api/estate", () => {
  test("returns the estate row with version references and honest coverage", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estate.id).toBe("estate-1");
    // With the cited head unchanged, the completed narrative is still current.
    expect(body.estate.status).toBe("completed");
    expect(body.estate.storedStatus).toBe("completed");
    expect(body.estate.stale).toBe(false);
    expect(body.estate.staleReason).toBeNull();
    expect(body.estate.result).toEqual(
      expect.objectContaining({ narrative: "Sampled estate." }),
    );
    expect(body.constituents).toEqual([
      expect.objectContaining({
        analysisId: "a-done",
        fullName: "o/done",
        status: "completed",
        analyzedSha: "sha-1",
      }),
    ]);
    expect(body.coverage.counts).toEqual({
      completed: 1,
      pending: 1,
      failed: 0,
      staleOnly: 0,
      unattempted: 1,
    });
    const pending = body.coverage.projects.find(
      (entry: { projectId: string }) => entry.projectId === "p-pending",
    );
    expect(pending.state).toBe("pending");
    expect(pending.pendingErrorCode).toBe("free_quota_exhausted");
    const unattempted = body.coverage.projects.find(
      (entry: { projectId: string }) => entry.projectId === "p-new",
    );
    expect(unattempted.state).toBe("unattempted");
  });

  test("excludes a constituent whose analyzedSha no longer matches the head", async () => {
    mockProjectFindMany.mockResolvedValue([
      {
        id: "p-done",
        fullName: "o/done",
        isArchived: false,
        defaultBranchHeadSha: "sha-advanced",
      },
      { id: "p-pending", fullName: "o/pending", isArchived: false, defaultBranchHeadSha: "sha-2" },
      { id: "p-new", fullName: "o/new", isArchived: false, defaultBranchHeadSha: null },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.constituents).toEqual([]);
    const done = body.coverage.projects.find(
      (entry: { projectId: string }) => entry.projectId === "p-done",
    );
    expect(done.state).toBe("stale_only");
    expect(done.versionId).toBeNull();
    expect(body.coverage.counts).toEqual({
      completed: 0,
      pending: 1,
      failed: 0,
      staleOnly: 1,
      unattempted: 1,
    });
  });

  test("does not present a completed narrative as current after a cited head advances", async () => {
    mockProjectFindMany.mockResolvedValue([
      {
        id: "p-done",
        fullName: "o/done",
        isArchived: false,
        defaultBranchHeadSha: "sha-advanced",
      },
      { id: "p-pending", fullName: "o/pending", isArchived: false, defaultBranchHeadSha: "sha-2" },
      { id: "p-new", fullName: "o/new", isArchived: false, defaultBranchHeadSha: null },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    // The stored completed synthesis is no longer current: it must be
    // presented as stale, never as a current completed result.
    expect(body.estate.status).toBe("stale");
    expect(body.estate.storedStatus).toBe("completed");
    expect(body.estate.stale).toBe(true);
    expect(body.estate.staleReason).toBe("cited_constituent_not_current");
    expect(body.estate.staleConstituentCount).toBe(1);
    // The stored version remains inspectable history, clearly separated
    // from the live coverage that invalidates it.
    expect(body.estate.result).toEqual(
      expect.objectContaining({ narrative: "Sampled estate." }),
    );
    expect(body.coverage.counts.staleOnly).toBe(1);
  });

  test("marks a completed estate stale when its cited versions are unverifiable", async () => {
    mockEstateFindFirst.mockResolvedValue({
      ...(await mockEstateFindFirst()),
      analysisVersionIds: "not-json",
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estate.status).toBe("stale");
    expect(body.estate.staleReason).toBe("constituent_versions_unverifiable");
  });

  test("discloses coverage even when no estate synthesis exists yet", async () => {
    mockEstateFindFirst.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estate).toBeNull();
    expect(body.constituents).toEqual([]);
    expect(body.coverage.counts.unattempted).toBe(1);
  });
});

describe("GET /api/estate with 201 cited constituents", () => {
  // Estate synthesis persists every current constituent version ID (bounded
  // by the 500-project scan), so a read must verify all of them, not just a
  // leading window. These fixtures place the only advanced head at index 200
  // so a truncated read would wrongly keep the completed narrative current.
  const citedProjects = Array.from({ length: 201 }, (_, index) => ({
    id: `p-${String(index).padStart(3, "0")}`,
    fullName: `o/repo-${index}`,
    isArchived: false,
    defaultBranchHeadSha: `sha-${index}`,
  }));
  const citedAnalyses = citedProjects.map((project, index) => ({
    id: `a-${String(index).padStart(3, "0")}`,
    projectId: project.id,
    status: "completed",
    analyzedSha: `sha-${index}`,
    promptVersion: "repository-analysis-v1",
    model: "google/gemma-4-26b-a4b-it:free",
    errorCode: null,
    retryAt: null,
    completedAt: new Date("2026-09-29T10:00:00.000Z"),
    createdAt: new Date("2026-09-29T09:00:00.000Z"),
    resultJson: null,
  }));
  const citedEstate = {
    id: "estate-cited",
    inputHash: "hash-cited",
    promptVersion: "estate-synthesis-v1",
    model: "google/gemma-4-26b-a4b-it:free",
    analysisVersionIds: JSON.stringify(citedAnalyses.map((a) => a.id)),
    coverageJson: "{}",
    resultJson: JSON.stringify({
      narrative: "Cited estate.",
      themes: [],
      uncertainties: [],
    }),
    status: "completed",
    errorCode: null,
    retryAt: null,
    createdAt: new Date("2026-09-30T12:30:00.000Z"),
    completedAt: new Date("2026-09-30T12:30:00.000Z"),
    updatedAt: new Date("2026-09-30T12:30:00.000Z"),
  };

  function installCitedFixtures(projects: typeof citedProjects) {
    mockEstateFindFirst.mockResolvedValue(citedEstate);
    mockProjectFindMany.mockResolvedValue(projects);
    mockAnalysisFindMany.mockImplementation((args: {
      where?: { id?: { in?: string[] } };
    }) => {
      const idFilter = args?.where?.id?.in;
      if (idFilter) {
        return Promise.resolve(
          citedAnalyses.filter((analysis) => idFilter.includes(analysis.id)),
        );
      }
      return Promise.resolve(citedAnalyses);
    });
  }

  test("reports stale when only the last cited head (index 200) advances", async () => {
    const advanced = citedProjects.map((project, index) =>
      index === 200
        ? { ...project, defaultBranchHeadSha: "sha-advanced" }
        : project,
    );
    installCitedFixtures(advanced);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estate.status).toBe("stale");
    expect(body.estate.storedStatus).toBe("completed");
    expect(body.estate.stale).toBe(true);
    expect(body.estate.staleReason).toBe("cited_constituent_not_current");
    expect(body.estate.staleConstituentCount).toBe(1);
    // The stored narrative stays inspectable history even though it is no
    // longer presented as current.
    expect(body.estate.result).toEqual(
      expect.objectContaining({ narrative: "Cited estate." }),
    );
    // The stale constituent is dropped from current constituents while the
    // other 200 remain.
    expect(body.constituents).toHaveLength(200);
    expect(
      body.constituents.some(
        (entry: { analysisId: string }) => entry.analysisId === "a-200",
      ),
    ).toBe(false);
    expect(
      body.constituents.some(
        (entry: { analysisId: string }) => entry.analysisId === "a-199",
      ),
    ).toBe(true);
    expect(body.coverage.counts.completed).toBe(200);
    expect(body.coverage.counts.staleOnly).toBe(1);
  });

  test("keeps an unchanged 201-citation synthesis current", async () => {
    installCitedFixtures(citedProjects);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estate.status).toBe("completed");
    expect(body.estate.storedStatus).toBe("completed");
    expect(body.estate.stale).toBe(false);
    expect(body.estate.staleReason).toBeNull();
    expect(body.constituents).toHaveLength(201);
    expect(body.coverage.counts.completed).toBe(201);
    expect(body.coverage.counts.staleOnly).toBe(0);
  });
});

describe("POST /api/estate/synthesize", () => {
  function makeRequest(token?: string) {
    return new Request("http://localhost/api/estate/synthesize", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  test("rejects unauthenticated synthesis before running", async () => {
    const response = await POST(makeRequest() as never);
    expect(response.status).toBe(401);
    expect(mockRunEstateSynthesis).not.toHaveBeenCalled();
  });

  test("returns sanitized run state for authorized callers", async () => {
    const response = await POST(makeRequest("test-token") as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "pending",
      estateId: "estate-2",
      errorCode: "free_quota_exhausted",
      retryAt: "2026-09-30T13:00:00.000Z",
    });
  });
});
