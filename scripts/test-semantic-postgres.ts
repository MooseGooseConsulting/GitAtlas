import { randomInt } from "node:crypto";
import { db } from "../src/lib/db";

const rollbackMarker = "rollback semantic postgres fixture";

async function main() {
  try {
    await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          githubId: -randomInt(1_000_000, 2_000_000_000),
          name: "semantic-fixture",
          fullName: "gitatlas-test/semantic-fixture",
          htmlUrl: "https://github.com/gitatlas-test/semantic-fixture",
          ownerLogin: "gitatlas-test",
          githubCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
          githubUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
          defaultBranchHeadSha: "revision-one",
        },
      });
      const first = await tx.repositoryAnalysis.create({
        data: {
          projectId: project.id,
          analyzedSha: "revision-one",
          evidenceHash: "evidence-one",
          inputHash: "input-one",
          promptVersion: "repository-analysis-v1",
          model: "google/gemma-4-26b-a4b-it:free",
          evidenceJson: JSON.stringify([
            { id: "repo:metadata", sourceUrl: project.htmlUrl },
          ]),
          ownerNotesJson: "[]",
          samplingBoundary: "One repository metadata record only.",
          resultJson: JSON.stringify({
            summary: "Fixture repository.",
            citations: [{ evidenceId: "repo:metadata" }],
          }),
          status: "completed",
          completedAt: new Date(),
        },
      });
      await tx.ownerNote.create({
        data: {
          projectId: project.id,
          author: "fixture",
          provenance: "owner",
          note: "Fixture correction; not source evidence.",
        },
      });
      await tx.repositoryAnalysis.update({
        where: { id: first.id },
        data: { status: "stale" },
      });
      const second = await tx.repositoryAnalysis.create({
        data: {
          projectId: project.id,
          analyzedSha: "revision-two",
          evidenceHash: "evidence-two",
          inputHash: "input-two",
          promptVersion: "repository-analysis-v1",
          model: "google/gemma-4-26b-a4b-it:free",
          evidenceJson: JSON.stringify([
            { id: "repo:metadata", sourceUrl: project.htmlUrl },
          ]),
          ownerNotesJson: JSON.stringify([
            { provenance: "owner", note: "Fixture correction." },
          ]),
          samplingBoundary: "One repository metadata record only.",
          status: "pending",
          errorCode: "free_quota_exhausted",
          retryAt: new Date(Date.now() + 60_000),
        },
      });
      const [versions, notes] = await Promise.all([
        tx.repositoryAnalysis.findMany({
          where: { projectId: project.id },
          orderBy: { analyzedSha: "asc" },
        }),
        tx.ownerNote.findMany({ where: { projectId: project.id } }),
      ]);
      if (
        versions.length !== 2 ||
        versions[0].status !== "stale" ||
        versions[1].status !== "pending" ||
        versions[1].errorCode !== "free_quota_exhausted" ||
        !versions[1].retryAt ||
        notes.length !== 1 ||
        notes[0].provenance !== "owner"
      ) {
        throw new Error("semantic persistence assertions failed");
      }
      throw new Error(rollbackMarker);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== rollbackMarker) {
      console.error("Semantic PostgreSQL fixture failed.");
      process.exitCode = 1;
      return;
    }
  } finally {
    await db.$disconnect();
  }
  console.log(
    "Semantic PostgreSQL fixture passed: two retained revisions, stale history, owner provenance, and resumable quota state.",
  );
}

void main();