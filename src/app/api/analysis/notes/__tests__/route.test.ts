import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockProjectFindUnique, mockOwnerNoteCreate } = vi.hoisted(() => ({
  mockProjectFindUnique: vi.fn(),
  mockOwnerNoteCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: mockProjectFindUnique },
    ownerNote: { create: mockOwnerNoteCreate },
  },
}));

const { POST } = await import("../route");
const originalToken = process.env.GITATLAS_INTERNAL_SYNC_TOKEN;

function makeRequest(body: unknown, token?: string) {
  return new Request("http://localhost/api/analysis/notes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GITATLAS_INTERNAL_SYNC_TOKEN = "test-token";
  mockProjectFindUnique.mockReset().mockResolvedValue({ id: "project-1" });
  mockOwnerNoteCreate.mockReset().mockResolvedValue({
    id: "note-1",
    projectId: "project-1",
    author: "operator",
    provenance: "owner",
    note: "Correction",
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
  });
});

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  } else {
    process.env.GITATLAS_INTERNAL_SYNC_TOKEN = originalToken;
  }
});

describe("owner analysis notes", () => {
  test("rejects unauthenticated owner notes before database access", async () => {
    const response = await POST(
      makeRequest({ projectId: "project-1", note: "Correction" }) as never,
    );

    expect(response.status).toBe(401);
    expect(mockProjectFindUnique).not.toHaveBeenCalled();
    expect(mockOwnerNoteCreate).not.toHaveBeenCalled();
  });

  test("persists owner provenance separately from analysis evidence", async () => {
    const response = await POST(
      makeRequest(
        { projectId: "project-1", note: "Correction", author: "maintainer" },
        "test-token",
      ) as never,
    );

    expect(response.status).toBe(201);
    expect(mockOwnerNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: "project-1",
          author: "maintainer",
          provenance: "owner",
          note: "Correction",
        },
      }),
    );
  });
});