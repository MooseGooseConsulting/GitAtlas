import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockProjectFindMany,
  mockWorkResourceFindMany,
  mockOwnerNoteFindMany,
  mockAnalysisFindUnique,
  mockAnalysisCreate,
  mockAnalysisUpdateMany,
  mockAnalysisUpdate,
  mockWorkerFindUnique,
  mockWorkerUpsert,
  mockCatalog,
  mockFreeChat,
  mockSourceSamples,
  MockFreeRouteError,
} = vi.hoisted(() => ({
  mockProjectFindMany: vi.fn(),
  mockWorkResourceFindMany: vi.fn(),
  mockOwnerNoteFindMany: vi.fn(),
  mockAnalysisFindUnique: vi.fn(),
  mockAnalysisCreate: vi.fn(),
  mockAnalysisUpdateMany: vi.fn(),
  mockAnalysisUpdate: vi.fn(),
  mockWorkerFindUnique: vi.fn(),
  mockWorkerUpsert: vi.fn(),
  mockCatalog: vi.fn(),
  mockFreeChat: vi.fn(),
  mockSourceSamples: vi.fn(),
  MockFreeRouteError: class MockFreeRouteError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findMany: mockProjectFindMany },
    workResource: { findMany: mockWorkResourceFindMany },
    ownerNote: { findMany: mockOwnerNoteFindMany },
    repositoryAnalysis: {
      findUnique: mockAnalysisFindUnique,
      create: mockAnalysisCreate,
      updateMany: mockAnalysisUpdateMany,
      update: mockAnalysisUpdate,
    },
    semanticWorkerState: {
      findUnique: mockWorkerFindUnique,
      upsert: mockWorkerUpsert,
    },
  },
}));

vi.mock("@/lib/llm", () => ({
  getVerifiedFreeModel: mockCatalog,
  chatWithFreeModel: mockFreeChat,
  FreeRouteError: MockFreeRouteError,
  DEFAULT_FREE_OPENROUTER_MODEL: "google/gemma-4-26b-a4b-it:free",
}));

vi.mock("@/lib/github-source-evidence", () => ({
  fetchRepositorySourceSamples: mockSourceSamples,
}));

const { runNextSemanticAnalysis, buildSemanticInput } =
  await import("../semantic-analysis");

const project = {
  id: "project-1",
  githubId: 101,
  ownerLogin: "sample-owner",
  name: "sample-repo",
  fullName: "sample-owner/sample-repo",
  description: "A source-backed fixture",
  htmlUrl: "https://github.com/sample-owner/sample-repo",
  defaultBranch: "main",
  defaultBranchHeadSha: "sha-one",
  language: "TypeScript",
  topics: "tooling",
};

const sourceSample = {
  evidenceId: "source:README.md",
  path: "README.md",
  sourceUrl:
    "https://github.com/sample-owner/sample-repo/blob/sha-one/README.md",
  excerpt: "# Sample source evidence",
  truncated: false,
};

const workResource = {
  id: "resource-1",
  projectId: "project-1",
  sourceType: "issue",
  externalId: "42",
  title: "Add bounded queue",
  sourceUrl: "https://github.com/sample-owner/sample-repo/issues/42",
  sourceState: "open",
  sourceUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const validAnalysis = {
  summary: "A bounded queue implementation.",
  tags: ["queue", "tooling"],
  category: "tool",
  citations: [
    {
      evidenceId: "work:resource-1",
      claim: "The repository tracks a queue-related issue.",
    },
  ],
  uncertainties: ["The available sample does not show implementation status."],
};

beforeEach(() => {
  mockProjectFindMany.mockReset().mockResolvedValue([project]);
  mockWorkResourceFindMany.mockReset().mockResolvedValue([workResource]);
  mockOwnerNoteFindMany.mockReset().mockResolvedValue([]);
  mockAnalysisFindUnique.mockReset().mockResolvedValue(null);
  mockAnalysisCreate.mockReset().mockImplementation(({ data }) =>
    Promise.resolve({ id: "analysis-1", ...data }),
  );
  mockAnalysisUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockAnalysisUpdate.mockReset().mockResolvedValue({ id: "analysis-1" });
  mockWorkerFindUnique.mockReset().mockResolvedValue(null);
  mockWorkerUpsert.mockReset().mockResolvedValue({});
  mockCatalog.mockReset().mockResolvedValue("google/gemma-4-26b-a4b-it:free");
  mockFreeChat.mockReset().mockResolvedValue(JSON.stringify(validAnalysis));
  mockSourceSamples.mockReset().mockResolvedValue([sourceSample]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned semantic analysis", () => {
  test("builds bounded, source-cited input and distinct owner-note context", () => {
    const input = buildSemanticInput(project, [workResource], [
      {
        id: "note-1",
        note: "Owner says this repo is an experiment.",
        author: "owner",
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    ],
      [sourceSample],
    );

    expect(input.evidence).toContainEqual(
      expect.objectContaining({
        id: "work:resource-1",
        sourceUrl: workResource.sourceUrl,
      }),
    );
    expect(input.ownerNotes).toEqual([
      expect.objectContaining({ id: "note-1", provenance: "owner" }),
    ]);
    expect(input.evidence).toContainEqual(
      expect.objectContaining({
        id: "source:README.md",
        kind: "readme_sample",
        observedAt: "sha-one",
        sourceUrl: sourceSample.sourceUrl,
      }),
    );
    expect(input.samplingBoundary).toMatch(/sample|limit/i);
  });

  test("persists one schema-valid free analysis with revision provenance", async () => {
    const result = await runNextSemanticAnalysis();

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(mockCatalog).toHaveBeenCalledOnce();
    expect(mockFreeChat).toHaveBeenCalledOnce();
    expect(mockFreeChat.mock.calls[0][0].model).toBe(
      "google/gemma-4-26b-a4b-it:free",
    );
    expect(mockAnalysisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          analyzedSha: "sha-one",
          promptVersion: expect.any(String),
          model: "google/gemma-4-26b-a4b-it:free",
          evidenceJson: expect.any(String),
          samplingBoundary: expect.any(String),
          status: "processing",
        }),
      }),
    );
    expect(mockAnalysisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "analysis-1" },
        data: expect.objectContaining({
          status: "completed",
          resultJson: expect.any(String),
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  test("does not duplicate unchanged completed evidence revisions", async () => {
    mockAnalysisFindUnique.mockResolvedValue({
      id: "analysis-existing",
      status: "completed",
      resultJson: JSON.stringify(validAnalysis),
    });

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("skipped");
    expect(mockFreeChat).not.toHaveBeenCalled();
    expect(mockAnalysisCreate).not.toHaveBeenCalled();
  });

  test("retains old versions and marks them stale when the default SHA changes", async () => {
    mockAnalysisFindUnique.mockResolvedValue(null);
    mockAnalysisUpdateMany.mockResolvedValue({ count: 1 });

    const result = await runNextSemanticAnalysis();

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(mockAnalysisUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", status: "completed" },
        data: { status: "stale" },
      }),
    );
    expect(mockAnalysisCreate).toHaveBeenCalledOnce();
  });

  test("creates a new retained version when source evidence changes at the same SHA", async () => {
    mockAnalysisFindUnique.mockResolvedValue(null);
    mockWorkResourceFindMany.mockResolvedValue([
      {
        ...workResource,
        title: "A changed issue title from source refresh",
      },
    ]);

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("completed");
    expect(mockAnalysisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          analyzedSha: "sha-one",
          evidenceJson: expect.stringContaining(
            "A changed issue title from source refresh",
          ),
        }),
      }),
    );
    expect(mockAnalysisUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", status: "completed" },
        data: { status: "stale" },
      }),
    );
  });

  test("owner notes change the next input without replacing prior versions", async () => {
    mockOwnerNoteFindMany.mockResolvedValue([
      {
        id: "note-1",
        projectId: "project-1",
        note: "This is an experiment, not a released tool.",
        author: "maintainer",
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    ]);

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("completed");
    expect(mockAnalysisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerNotesJson: expect.stringContaining(
            "This is an experiment, not a released tool.",
          ),
        }),
      }),
    );
    const prompt = mockFreeChat.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("This is an experiment, not a released tool.");
    expect(prompt).toContain('"provenance":"owner"');
    expect(mockAnalysisUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", status: "completed" },
        data: { status: "stale" },
      }),
    );
  });

  test("resumes an expired pending revision without creating a duplicate", async () => {
    mockAnalysisFindUnique.mockResolvedValue({
      id: "analysis-resume",
      status: "pending",
      retryAt: new Date(Date.now() - 1000),
      errorCode: "free_quota_exhausted",
    });
    mockAnalysisUpdate.mockResolvedValue({ id: "analysis-resume" });

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("completed");
    expect(mockAnalysisCreate).not.toHaveBeenCalled();
    expect(mockFreeChat).toHaveBeenCalledOnce();
    expect(mockAnalysisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "analysis-resume" },
        data: { status: "processing", errorCode: null, retryAt: null },
      }),
    );
  });

  test("records quota exhaustion as pending and never chooses a paid route", async () => {
    mockFreeChat.mockRejectedValue(new MockFreeRouteError("free_quota_exhausted"));

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("pending");
    expect(mockAnalysisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "analysis-1" },
        data: expect.objectContaining({
          status: "pending",
          errorCode: "free_quota_exhausted",
          retryAt: expect.any(Date),
        }),
      }),
    );
    expect(mockFreeChat).toHaveBeenCalledOnce();
  });

  test("leaves work pending if no catalog-verified free route is available", async () => {
    mockCatalog.mockResolvedValue(null);

    const result = await runNextSemanticAnalysis();

    expect(result.status).toBe("pending");
    expect(mockFreeChat).not.toHaveBeenCalled();
    expect(mockAnalysisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "analysis-1" },
        data: expect.objectContaining({
          status: "pending",
          errorCode: "free_model_unavailable",
        }),
      }),
    );
  });

  test("does not infer from metadata when revision-pinned source samples are unavailable", async () => {
    mockSourceSamples.mockResolvedValue([]);

    const result = await runNextSemanticAnalysis();

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "source_sample_unavailable",
    });
    expect(mockCatalog).not.toHaveBeenCalled();
    expect(mockFreeChat).not.toHaveBeenCalled();
    expect(mockAnalysisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorCode: "source_sample_unavailable",
        }),
      }),
    );
  });

  test("persists schema-invalid model output as a safe failure", async () => {
    mockFreeChat.mockResolvedValue(JSON.stringify({ summary: "omitted fields" }));

    const result = await runNextSemanticAnalysis();

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "invalid_analysis_schema",
    });
    expect(mockAnalysisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorCode: "invalid_analysis_schema",
        }),
      }),
    );
  });

  test("starts past the persisted cursor instead of the fixed first window", async () => {
    mockWorkerFindUnique.mockResolvedValue({
      id: "semantic-worker",
      cursorProjectId: "project-cursor",
    });

    const result = await runNextSemanticAnalysis();

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { gt: "project-cursor" },
        }),
      }),
    );
    expect(mockWorkerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "semantic-worker" },
        update: { cursorProjectId: "project-1" },
      }),
    );
  });

  test("wraps to the first window when nothing remains past the cursor", async () => {
    mockWorkerFindUnique.mockResolvedValue({
      id: "semantic-worker",
      cursorProjectId: "project-cursor",
    });
    mockProjectFindMany.mockImplementation((args) => {
      const cursorFilter = args?.where?.id;
      if (cursorFilter && "gt" in cursorFilter) {
        return Promise.resolve([]);
      }
      return Promise.resolve([project]);
    });

    const result = await runNextSemanticAnalysis();

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(mockProjectFindMany).toHaveBeenCalledTimes(2);
    expect(mockWorkerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "semantic-worker" },
        update: { cursorProjectId: "project-1" },
      }),
    );
  });

  test("does not disturb the rotation cursor for an explicit project tick", async () => {
    const result = await runNextSemanticAnalysis({ projectId: "project-1" });

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(mockWorkerFindUnique).not.toHaveBeenCalled();
    expect(mockWorkerUpsert).not.toHaveBeenCalled();
  });

  test("advances the cursor past a project that failed source sampling", async () => {
    mockSourceSamples.mockResolvedValue([]);

    const result = await runNextSemanticAnalysis();

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "source_sample_unavailable",
    });
    expect(mockWorkerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "semantic-worker" },
        update: { cursorProjectId: "project-1" },
      }),
    );
  });

  test("scans in stable ID order so a cold project beyond 500 hot ones is not starved", async () => {
    // 501 projects updated far more recently than one older project whose ID
    // sorts first. With the previous githubUpdatedAt-descending window the
    // cold project sat outside the first 500 and below the saved cursor, so
    // it could never be selected; a stable ID-ordered scan includes it.
    const catalog = [
      makeCatalogProject("a-cold", new Date("2020-01-01T00:00:00.000Z")),
      ...Array.from({ length: 501 }, (_, index) =>
        makeCatalogProject(
          `z-${String(index + 1).padStart(4, "0")}`,
          new Date(2026, 8, 30, 12, 0, index % 60),
        ),
      ),
    ];
    mockProjectFindMany.mockImplementation(makeCatalogFindMany(catalog));
    mockWorkResourceFindMany.mockResolvedValue([]);
    mockFreeChat.mockResolvedValue(
      JSON.stringify({ ...validAnalysis, citations: [] }),
    );

    const result = await runNextSemanticAnalysis();

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.projectId).toBe("a-cold");
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ id: "asc" }],
      }),
    );
    expect(mockAnalysisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "a-cold" }),
      }),
    );
  });

  test("resumed ticks eventually visit every eligible ID across bounded windows and wraparound", async () => {
    const catalog = [
      makeCatalogProject("a-cold", new Date("2020-01-01T00:00:00.000Z")),
      ...Array.from({ length: 501 }, (_, index) =>
        makeCatalogProject(
          `z-${String(index + 1).padStart(4, "0")}`,
          new Date(2026, 8, 30, 12, 0, index % 60),
        ),
      ),
    ];
    const processed = new Set<string>();
    let savedCursor: string | null = null;
    mockProjectFindMany.mockImplementation(makeCatalogFindMany(catalog));
    mockWorkResourceFindMany.mockResolvedValue([]);
    mockFreeChat.mockResolvedValue(
      JSON.stringify({ ...validAnalysis, citations: [] }),
    );
    mockWorkerFindUnique.mockImplementation(() =>
      Promise.resolve(
        savedCursor
          ? { id: "semantic-worker", cursorProjectId: savedCursor }
          : null,
      ),
    );
    mockWorkerUpsert.mockImplementation(({ update }: { update: { cursorProjectId: string | null } }) => {
      savedCursor = update.cursorProjectId;
      return Promise.resolve({});
    });
    mockAnalysisFindUnique.mockImplementation((args: {
      where: {
        projectId_inputHash: { projectId: string; inputHash: string };
      };
    }) => {
      const { projectId } = args.where.projectId_inputHash;
      return Promise.resolve(
        processed.has(projectId)
          ? { id: `analysis-${projectId}`, status: "completed" }
          : null,
      );
    });
    mockAnalysisCreate.mockImplementation(({ data }: { data: { projectId: string } }) =>
      Promise.resolve({ id: `analysis-${data.projectId}`, ...data }),
    );

    let finalStatus = "idle";
    for (let tick = 0; tick < 600; tick += 1) {
      const result = await runNextSemanticAnalysis();
      if (result.status === "completed" && result.projectId) {
        processed.add(result.projectId);
        continue;
      }
      finalStatus = result.status;
      break;
    }

    expect(processed.size).toBe(catalog.length);
    expect(processed.has("a-cold")).toBe(true);
    expect(finalStatus).toBe("skipped");
  });
});

function makeCatalogProject(id: string, githubUpdatedAt: Date) {
  return {
    id,
    githubId: 1,
    ownerLogin: "sample-owner",
    name: id,
    fullName: `sample-owner/${id}`,
    description: null,
    htmlUrl: `https://github.com/sample-owner/${id}`,
    isArchived: false,
    defaultBranch: "main",
    defaultBranchHeadSha: `sha-${id}`,
    githubUpdatedAt,
    inventoryFetchedAt: null,
    inventoryStatus: "current",
    language: null,
    topics: "",
  };
}

// Simulates the persistence layer's filter/order/take semantics so the test
// exercises real window traversal, including IDs ordered differently from
// update time and wraparound past the last cursor.
function makeCatalogFindMany(
  catalog: Array<Record<string, unknown>>,
): (args: {
  where?: { id?: { gt?: string } };
  orderBy?: Array<Record<string, string>>;
  take?: number;
}) => Promise<unknown[]> {
  return (args) => {
    let rows = catalog.filter(
      (project) =>
        project.isArchived === false &&
        project.defaultBranchHeadSha !== null &&
        project.defaultBranchHeadSha !== undefined,
    );
    const gt = args?.where?.id?.gt;
    if (gt !== undefined) {
      rows = rows.filter((project) => String(project.id) > gt);
    }
    const orderBy = args?.orderBy ?? [];
    rows = [...rows].sort((a, b) => {
      for (const clause of orderBy) {
        const field = Object.keys(clause)[0] ?? "id";
        const direction = clause[field] === "desc" ? -1 : 1;
        const av = a[field] as string | number | Date;
        const bv = b[field] as string | number | Date;
        if (av < bv) return -1 * direction;
        if (av > bv) return 1 * direction;
      }
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return Promise.resolve(rows.slice(0, args?.take));
  };
}
