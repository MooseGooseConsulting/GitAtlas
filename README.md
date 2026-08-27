# GitAtlas

GitAtlas is a visual and semantic map of a software estate. It is designed to answer questions that ordinary GitHub search and repository lists cannot answer reliably:

- What does this repository actually do now?
- Which larger system/product does it belong to?
- Where does source/runtime/deployment/data/presentation authority live?
- What replaced or superseded this repo?
- Is this an active product, prototype, imported copy, fork, vendor-derived dependency, or historical reference?
- Do I already have an implementation of the capability I am about to build?

## Current direction

GitAtlas already has substantial repository ingestion, source/dependency inspection, visualization, search, activity, comparison, and technical-similarity functionality.

The current work is adding a semantic layer across the entire corpus.

**GitAtlas itself should remain thin.** Existing capable coding/research harnesses perform repository and corpus reasoning. GitAtlas stores/version those semantic artifacts, tracks which repository revisions they describe, and renders/query the results.

Most semantic behaviors should begin as versioned prompts/skills rather than custom in-app agent classes.

See:

- [`AGENTS.md`](AGENTS.md) — implementation rules for coding agents
- [`docs/architecture.md`](docs/architecture.md) — authoritative architecture
- [`docs/thoughts.md`](docs/thoughts.md) — product intent/history
- [Issue #9](https://github.com/MooseGooseConsulting/GitAtlas/issues/9) — current epic and execution order

## First semantic milestone

1. establish a thin handoff to an existing coding/research harness (#10);
2. define repository-understanding as a reusable prompt/skill (#11);
3. persist minimal versioned semantic artifacts (#12);
4. define estate/corpus understanding as a reusable prompt/skill (#13);
5. run the full real corpus early and let the results drive later architecture/UI work (#19).

## Important distinction

GitAtlas already computes useful structural and technical signals such as dependencies, frameworks, tags, languages, and similarity.

Those remain valuable, but:

> **Technical similarity is not semantic topology.**

Semantic conclusions about purpose, authority, lineage, product boundaries, duplication, and reuse should come from LLM reasoning over real repository evidence, not deterministic classification rules.

## Legacy AI enrichment path

The existing `src/lib/llm.ts`, `/api/sync/enrich-next`, and `mini-services/sync-worker.ts` belong to the previous in-app AI enrichment architecture. They are retained for compatibility while issue #10 establishes the replacement/bypass path for new semantic work.

Do not extend that legacy path into a larger custom agent framework.
