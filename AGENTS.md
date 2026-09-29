# GitAtlas Agent Instructions

Read `docs/architecture.md` before making architectural changes.

## Product intent

GitAtlas is the semantic map of the owner's Git corpus. It should help answer what repositories actually do, how they fit together, which systems/products exist, what is authoritative, what is historical/imported/vendor-derived, and whether a capability already exists somewhere in the estate.

## Architectural rule

**GitAtlas is not an agent framework.**

Existing capable coding/research harnesses should perform repository and corpus reasoning. GitAtlas should remain thin: prepare context, invoke or receive work from those harnesses, persist/version semantic artifacts, track repository revisions, and render/query the results.

### Do not build

Do not introduce a custom:
- tool loop;
- model/provider router;
- subagent framework;
- repository-browsing agent runtime;
- semantic adjudication/state-machine framework;
- distributed workflow engine;
- generic graph ontology before the real corpus requires one.

Do not replace semantic reasoning with deterministic heuristics. Tags, dependency overlap, languages, filenames, archive flags, and similar signals may be evidence or retrieval aids; they do not determine what a repository means or how repositories relate.

## Semantic implementation style

Prefer versioned prompts/skills executed by an existing coding/research harness for tasks such as:
- understand one repository;
- understand the entire estate;
- review an estate analysis;
- answer corpus questions such as "Do I already have this?".

The harness should be free to inspect source, docs, history, and sibling repositories as needed.

## Current migration

Issues #9-#19 define the current direction. In particular:
- #10 establishes the thin harness handoff;
- #11 defines repository understanding as a prompt/skill;
- #12 adds minimal versioned semantic artifacts;
- #13 defines estate understanding as a prompt/skill;
- #19 runs the real corpus early and lets those results drive later product work.

The existing `src/lib/llm.ts`, `src/app/api/sync/enrich-next`, and `mini-services/sync-worker.ts` belong to the legacy in-app AI enrichment architecture. Preserve compatibility while #10 replaces or bypasses that path; do not extend it into a larger orchestration framework.

## Preserve useful existing work

Do not rewrite GitAtlas from scratch. Preserve useful GitHub ingestion, Prisma persistence, repository metadata, graph/grid/timeline/network/search/detail views, technical-similarity features, and visual polish unless the new semantic model demonstrates a better replacement.

**Technical similarity is useful evidence. It is not semantic topology.**
