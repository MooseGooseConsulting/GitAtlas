import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./database-url-resolve";

const db = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

const rollbackMarker = "rollback estate postgres fixture";

async function main() {
  try {
    await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          githubId: -randomInt(1_000_000, 2_000_000_000),
          name: "estate-fixture",
          fullName: "gitatlas-test/estate-fixture",
          htmlUrl: "https://github.com/gitatlas-test/estate-fixture",
          ownerLogin: "gitatlas-test",
          githubCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
          githubUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
          defaultBranchHeadSha: "revision-one",
        },
      });
      const analysis = await tx.repositoryAnalysis.create({
        data: {
          projectId: project.id,
          analyzedSha: "revision-one",
          evidenceHash: "evidence-one",
          inputHash: `estate-input-${project.id}`,
          promptVersion: "repository-analysis-v1",
          model: "google/gemma-4-26b-a4b-it:free",
          evidenceJson: "[]",
          ownerNotesJson: "[]",
          samplingBoundary: "Fixture boundary.",
          resultJson: JSON.stringify({ summary: "Fixture." }),
          status: "completed",
          completedAt: new Date(),
        },
      });
      const coverage = {
        generatedAt: new Date().toISOString(),
        projectCount: 2,
        archivedCount: 0,
        counts: {
          completed: 1,
          pending: 0,
          failed: 0,
          staleOnly: 0,
          unattempted: 1,
        },
        projects: [
          {
            projectId: project.id,
            fullName: project.fullName,
            state: "completed",
            versionId: analysis.id,
          },
          {
            projectId: "missing",
            fullName: "gitatlas-test/unanalyzed",
            state: "unattempted",
            versionId: null,
          },
        ],
      };
      const estate = await tx.estateAnalysis.create({
        data: {
          inputHash: `estate-hash-${project.id}`,
          promptVersion: "estate-synthesis-v1",
          model: "google/gemma-4-26b-a4b-it:free",
          analysisVersionIds: JSON.stringify([analysis.id]),
          coverageJson: JSON.stringify(coverage),
          status: "pending",
          errorCode: "free_quota_exhausted",
          retryAt: new Date(Date.now() + 60_000),
        },
      });

      const source = await tx.workResource.create({
        data: {
          projectId: project.id,
          sourceType: "issue",
          externalId: "501",
          issueNumber: 1,
          title: "Blocked fixture",
          sourceUrl:
            "https://github.com/gitatlas-test/estate-fixture/issues/1",
          sourceState: "open",
          lastSeenAt: new Date(),
        },
      });
      const target = await tx.workResource.create({
        data: {
          projectId: project.id,
          sourceType: "issue",
          externalId: "502",
          issueNumber: 2,
          title: "Open blocker fixture",
          sourceUrl:
            "https://github.com/gitatlas-test/estate-fixture/issues/2",
          sourceState: "open",
          lastSeenAt: new Date(),
        },
      });
      await tx.workReference.create({
        data: {
          sourceResourceId: source.id,
          targetResourceId: target.id,
          targetSourceType: "issue",
          targetExternalId: "issue:2",
          targetUrl: target.sourceUrl,
          relationshipType: "explicit",
          evidence: "source_url",
          category: "explicit_github_link",
          confidence: "authoritative",
          intent: "blocking",
        },
      });
      // Defaulted columns apply the mention-only classification.
      await tx.workReference.create({
        data: {
          sourceResourceId: target.id,
          targetResourceId: null,
          targetExternalId: "number:9",
          relationshipType: "inferred",
          evidence: "text_mention",
          category: "source_supported_inference",
          confidence: "supported",
        },
      });

      const other = await tx.project.create({
        data: {
          githubId: -randomInt(1_000_000, 2_000_000_000),
          name: "estate-fixture-peer",
          fullName: "gitatlas-test/estate-fixture-peer",
          htmlUrl: "https://github.com/gitatlas-test/estate-fixture-peer",
          ownerLogin: "gitatlas-test",
          githubCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
          githubUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await tx.projectEdge.create({
        data: {
          sourceProjectId: project.id,
          targetProjectId: other.id,
          category: "heuristic_similarity",
          relationshipType: "shared_topics",
          confidence: "exploratory",
          evidenceJson: JSON.stringify({
            sharedTopics: ["fixture"],
            sharedLanguage: "TypeScript",
            basis: "project_metadata",
          }),
        },
      });

      const [estates, references, edges] = await Promise.all([
        tx.estateAnalysis.findMany({ where: { id: estate.id } }),
        tx.workReference.findMany({
          where: { sourceResourceId: { in: [source.id, target.id] } },
          orderBy: { targetExternalId: "asc" },
        }),
        tx.projectEdge.findMany({ where: { sourceProjectId: project.id } }),
      ]);
      const parsedCoverage = JSON.parse(estates[0]?.coverageJson ?? "{}");
      const cited = JSON.parse(estates[0]?.analysisVersionIds ?? "[]");
      if (
        estates.length !== 1 ||
        estates[0].status !== "pending" ||
        estates[0].errorCode !== "free_quota_exhausted" ||
        cited[0] !== analysis.id ||
        parsedCoverage.counts.unattempted !== 1 ||
        references.length !== 2 ||
        references[0].category !== "explicit_github_link" ||
        references[0].confidence !== "authoritative" ||
        references[0].intent !== "blocking" ||
        references[1].category !== "source_supported_inference" ||
        references[1].intent !== "reference" ||
        edges.length !== 1 ||
        edges[0].category !== "heuristic_similarity" ||
        edges[0].confidence !== "exploratory"
      ) {
        throw new Error("estate persistence assertions failed");
      }
      throw new Error(rollbackMarker);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== rollbackMarker) {
      console.error("Estate PostgreSQL fixture failed.");
      process.exitCode = 1;
      return;
    }
  } finally {
    await db.$disconnect();
  }
  console.log(
    "Estate PostgreSQL fixture passed: cited versions, disclosed coverage, typed reference edges, and heuristic project edges.",
  );
}

void main();
