# GitAtlas Architecture

## Purpose

GitAtlas is the durable semantic map of an entire Git corpus. Its job is to remember and visualize what repositories actually are, how they fit into larger systems, what is current versus historical, where authority lives, what was imported/forked/superseded, and where an existing implementation can be reused instead of rebuilt.

The architectural priority is **semantic understanding of the real corpus**, not building another agent platform.

## Three-layer architecture

### 1. GitAtlas product code

GitAtlas itself should own only product-specific responsibilities:

- repository inventory and current default-branch revisions;
- existing GitHub metadata and structural/technical signals;
- versioned storage of repository-level semantic analyses;
- versioned storage of corpus/estate-level semantic analyses;
- lightweight owner notes/corrections;
- simple current/stale tracking tied to commit SHAs;
- visualization and exploration of the resulting semantic model;
- a thin invocation or import/export boundary to an existing coding/research harness.

GitAtlas should not duplicate capabilities already supplied by modern coding/research harnesses.

### 2. Versioned prompts / skills

Semantic tasks should normally be expressed as inspectable, versioned prompts or skills, including:

- repository understanding;
- estate/corpus understanding;
- second-pass semantic review;
- corpus research such as "Do I already have this?";
- focused comparison of related repositories.

These prompts should tell a capable harness what outcome is needed while leaving it free to investigate source, documentation, Git history, and sibling repositories as required.

Do not turn these prompts into rigid deterministic checklists. The harness is expected to reason.

### 3. Existing coding/research harnesses

Use an existing capable coding/research harness such as Codex, Claude Code, Cursor, or another suitable backend to perform the expensive semantic work:

- inspect repositories;
- navigate files and Git history;
- follow cross-repository evidence;
- use its own built-in tools/subagents where appropriate;
- reason about purpose, lineage, authority, maturity, boundaries, duplication, and reuse;
- emit structured semantic output plus a useful narrative.

GitAtlas may invoke the harness through a supported interface or emit/import work artifacts. Choose the smallest reliable integration.

## Hard architectural boundaries

Do **not** build a custom:

- LLM tool loop;
- provider/model router;
- subagent protocol/framework;
- repository-browsing runtime;
- distributed semantic workflow engine;
- semantic claim adjudication framework;
- generalized ontology/knowledge-graph platform before the real corpus proves it necessary.

Deterministic code may collect and organize evidence. It may detect that a repository changed. It may validate a returned schema. It may not determine semantic conclusions through rules such as dependency overlap, repository naming, archive state, language, or tags.

**Technical similarity is not semantic topology.**

## Initial semantic artifacts

Start with a deliberately small persistence model.

### RepositoryAnalysis

Versioned by repository and analyzed commit. Contains:

- repository identity and commit SHA;
- prompt/skill version;
- harness/model/run metadata when readily available;
- structured semantic output;
- human-readable narrative;
- unresolved questions/evidence references;
- status/error information.

### EstateAnalysis

Versioned corpus-level synthesis. Contains:

- repository-analysis versions/commits used;
- prompt/skill version;
- structured estate model;
- narrative explanation;
- unresolved questions;
- harness/model/run metadata when readily available.

### OwnerNote

Lightweight owner knowledge or corrections that can be attached to a repository, relationship, system, artifact, or the corpus generally and included in later semantic prompts.

Do not normalize every statement into claim/edge tables until actual corpus/UI/query needs justify that complexity.

## Legacy in-app AI pipeline

The current codebase contains an older architecture in which Next.js routes perform shallow/deep analysis and other AI enrichment through `src/lib/llm.ts`, and `src/app/api/sync/enrich-next` plus `mini-services/sync-worker.ts` orchestrate those routes.

That code is **legacy compatibility**, not the target semantic architecture.

During issue #10:

- replace or bypass the legacy prompt-to-chat-completions path for new semantic work;
- retain useful non-semantic GitHub ingestion/change-detection pieces;
- do not grow the existing enrichment worker into a larger agent orchestrator;
- remove legacy paths only after the replacement works and dependent UI behavior is understood.

## Delivery order

The first milestone is intentionally small and empirical:

1. #10 — establish the thinnest practical existing-harness handoff;
2. #11 — create and validate the repository-understanding prompt/skill;
3. #12 — persist versioned semantic artifacts and owner notes;
4. #13 — create the estate-understanding prompt/skill;
5. #19 — run the entire real corpus early.

The full-corpus output should determine how much of #14-#18 is genuinely necessary and what shape the UI should take.

## Existing functionality to preserve

GitAtlas already contains substantial useful application work: GitHub ingestion, repository persistence, source/dependency inspection, graph/grid/timeline/network views, search, detail panels, activity, comparison, and technical-similarity visualization.

Treat that as implementation capital. Evolve it around the semantic estate model rather than replacing the application wholesale.
