import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for VAL-UI-003: persisted unresolved outgoing
// WorkReference rows (targetResourceId null) must reach GET /api/relationships
// with their recorded evidence, provenance category and null target identity,
// while resolved incoming/outgoing rows keep project scoping and unrelated
// references stay excluded by the query predicate itself.

const {
  mockProjectFindUnique,
  mockProjectEdgeFindMany,
  mockReferenceFindMany,
  mockRefreshHeuristicEdges,
  mockIsInternalRequestAuthorized,
} = vi.hoisted(() => ({
  mockProjectFindUnique: vi.fn(),
  mockProjectEdgeFindMany: vi.fn(),
  mockReferenceFindMany: vi.fn(),
  mockRefreshHeuristicEdges: vi.fn(),
  mockIsInternalRequestAuthorized: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: mockProjectFindUnique },
    projectEdge: { findMany: mockProjectEdgeFindMany },
    workReference: { findMany: mockReferenceFindMany },
  },
}));

vi.mock("@/lib/project-edges", () => ({
  refreshHeuristicProjectEdges: mockRefreshHeuristicEdges,
}));

vi.mock("@/lib/internal-sync-auth", () => ({
  isInternalRequestAuthorized: mockIsInternalRequestAuthorized,
}));

import { GET } from "../route";

const projectA = { githubId: 77, fullName: "owner/alpha" };
const projectB = { githubId: 78, fullName: "owner/beta" };

type ReferenceRow = {
  id: string;
  relationshipType: string;
  category: string;
  confidence: string;
  intent: string;
  evidence: string;
  targetUrl: string | null;
  targetExternalId: string;
  targetSourceType: string | null;
  discoveredAt: Date;
  sourceResource: {
    sourceUrl: string;
    project: { githubId: number; fullName: string };
  };
  targetResource: {
    sourceUrl: string;
    project: { githubId: number; fullName: string };
  } | null;
};

const rows: ReferenceRow[] = [
  {
    // Unresolved outgoing inferred mention: no persisted target resource and
    // no URL was ever recorded for the target.
    id: "ref-unresolved-inferred",
    relationshipType: "inferred",
    category: "source_supported_inference",
    confidence: "inferred",
    intent: "reference",
    evidence: "text_mention",
    targetUrl: null,
    targetExternalId: "number:12",
    targetSourceType: null,
    discoveredAt: new Date("2026-09-30T10:00:00Z"),
    sourceResource: {
      sourceUrl: "https://github.com/owner/alpha/issues/3",
      project: projectA,
    },
    targetResource: null,
  },
  {
    // Unresolved outgoing explicit link: the target URL was genuinely
    // recorded at the source object, but no matching resource row exists.
    id: "ref-unresolved-explicit",
    relationshipType: "explicit",
    category: "explicit_github_link",
    confidence: "authoritative",
    intent: "reference",
    evidence: "source_url",
    targetUrl: "https://github.com/owner/alpha/issues/9",
    targetExternalId: "explicit:9",
    targetSourceType: "issue",
    discoveredAt: new Date("2026-09-30T09:00:00Z"),
    sourceResource: {
      sourceUrl: "https://github.com/owner/alpha/pull/4",
      project: projectA,
    },
    targetResource: null,
  },
  {
    // Resolved outgoing: source in project A, target persisted in project B.
    id: "ref-resolved-outgoing",
    relationshipType: "explicit",
    category: "explicit_github_link",
    confidence: "authoritative",
    intent: "reference",
    evidence: "source_url",
    targetUrl: "https://github.com/owner/beta/issues/2",
    targetExternalId: "explicit:2",
    targetSourceType: "issue",
    discoveredAt: new Date("2026-09-30T08:00:00Z"),
    sourceResource: {
      sourceUrl: "https://github.com/owner/alpha/issues/5",
      project: projectA,
    },
    targetResource: {
      sourceUrl: "https://github.com/owner/beta/issues/2",
      project: projectB,
    },
  },
  {
    // Resolved incoming: source persisted in project B, target in project A.
    id: "ref-resolved-incoming",
    relationshipType: "inferred",
    category: "source_supported_inference",
    confidence: "inferred",
    intent: "blocking",
    evidence: "text_mention",
    targetUrl: null,
    targetExternalId: "number:5",
    targetSourceType: "issue",
    discoveredAt: new Date("2026-09-30T07:00:00Z"),
    sourceResource: {
      sourceUrl: "https://github.com/owner/beta/issues/7",
      project: projectB,
    },
    targetResource: {
      sourceUrl: "https://github.com/owner/alpha/issues/5",
      project: projectA,
    },
  },
];

beforeEach(() => {
  mockProjectFindUnique.mockReset().mockResolvedValue(null);
  mockProjectEdgeFindMany.mockReset().mockResolvedValue([]);
  mockReferenceFindMany.mockReset().mockResolvedValue([]);
  mockRefreshHeuristicEdges.mockReset();
  mockIsInternalRequestAuthorized.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relationships API", () => {
  test("includes unresolved inferred and explicit references beside resolved ones", async () => {
    mockReferenceFindMany.mockResolvedValue(rows);

    const response = await GET(new NextRequest("http://localhost/api/relationships"));

    expect(response.status).toBe(200);
    const payload = await response.json();

    // The route query must not filter on target identity at all.
    expect(mockReferenceFindMany.mock.calls[0][0].where).toStrictEqual({});

    expect(payload.evidenceBacked).toHaveLength(4);
    const byId = new Map(
      payload.evidenceBacked.map((edge: { id: string }) => [edge.id, edge]),
    );

    // Unresolved inferred mention: null target identity, no invented URL.
    expect(byId.get("ref-unresolved-inferred")).toMatchObject({
      category: "source_supported_inference",
      confidence: "inferred",
      intent: "reference",
      evidence: "text_mention",
      sourceProject: projectA,
      sourceUrl: "https://github.com/owner/alpha/issues/3",
      targetProject: null,
      targetUrl: null,
      targetExternalId: "number:12",
    });

    // Unresolved explicit link: the genuinely recorded target URL survives.
    expect(byId.get("ref-unresolved-explicit")).toMatchObject({
      category: "explicit_github_link",
      evidence: "source_url",
      sourceProject: projectA,
      targetProject: null,
      targetUrl: "https://github.com/owner/alpha/issues/9",
      targetExternalId: "explicit:9",
    });

    // Resolved outgoing keeps the persisted target project identity.
    expect(byId.get("ref-resolved-outgoing")).toMatchObject({
      sourceProject: projectA,
      targetProject: projectB,
      targetUrl: "https://github.com/owner/beta/issues/2",
    });

    // Resolved incoming keeps both sides of the scoping.
    expect(byId.get("ref-resolved-incoming")).toMatchObject({
      sourceProject: projectB,
      targetProject: projectA,
      intent: "blocking",
    });
  });

  test("scopes the project filter to source and target sides so unrelated rows are excluded", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: "project-a" });
    mockReferenceFindMany.mockResolvedValue(rows);

    const response = await GET(
      new NextRequest("http://localhost/api/relationships?project=77"),
    );

    expect(response.status).toBe(200);
    expect(mockProjectFindUnique).toHaveBeenCalledWith({
      where: { githubId: 77 },
      select: { id: true },
    });

    // Both directions of the project scoping are matched by the query, so
    // references belonging to other projects are excluded by the database
    // predicate, and no target-identity filter is reintroduced.
    expect(mockReferenceFindMany.mock.calls[0][0].where).toStrictEqual({
      OR: [
        { sourceResource: { projectId: "project-a" } },
        { targetResource: { projectId: "project-a" } },
      ],
    });
  });

  test("keeps heuristic edge scoping on both directions", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: "project-a" });

    const response = await GET(
      new NextRequest("http://localhost/api/relationships?project=77"),
    );

    expect(response.status).toBe(200);
    expect(mockProjectEdgeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { sourceProjectId: "project-a" },
            { targetProjectId: "project-a" },
          ],
        },
      }),
    );
  });

  test("returns 404 without querying references for an unknown project filter", async () => {
    mockProjectFindUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/relationships?project=99"),
    );

    expect(response.status).toBe(404);
    expect(mockReferenceFindMany).not.toHaveBeenCalled();
    expect(mockProjectEdgeFindMany).not.toHaveBeenCalled();
  });
});
