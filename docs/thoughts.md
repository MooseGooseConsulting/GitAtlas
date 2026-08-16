# Git Atlas — Thoughts & Interpretation

> Historical product framing, updated August 2026 to reflect the current semantic architecture. See `docs/architecture.md` and issues #9-#19 for implementation authority.

## What You're Really Asking For

You have a **retrieval problem with your own tools**. You've built, forked, imported, and customized many projects, but when you need something you cannot reliably answer whether the capability already exists, where the current authority lives, or which older repositories are predecessors rather than active systems.

The core pain remains:

> **Do I already have something for this?**

GitAtlas should externalize enough understanding of the corpus that this no longer requires starting from zero.

## Product principles

1. **You need a map, not a list.** Repo names and raw GitHub metadata are not enough. GitAtlas should let you see the estate at a useful semantic level and drill into repositories, systems, relationships, and evidence.

2. **Semantic understanding is the backbone.** Tags and summaries were useful first-generation signals, but they are not sufficient. The system needs repository-level and corpus-level LLM reasoning that can understand purpose, authority, lineage, maturity, boundaries, duplication, and reuse.

3. **Source reality beats aspirational documentation.** READMEs can be stale or describe intent rather than implementation. A capable coding/research harness should inspect whatever evidence is necessary—source, docs, Git history, sibling repositories, deployment references, and owner notes.

4. **Organizations and repository boundaries matter, but repositories are not necessarily the product unit.** A meaningful system may span several repositories, while a single repository may contain imported/vendor/reference material that should not be mistaken for current authority.

5. **Visual understanding is core to the product.** GitAtlas should preserve its strong visual exploration work, but the visuals should eventually render the semantic estate model rather than treating technical similarity as the same thing as product topology.

## The deeper problem

This is about **semantic memory for the software estate**.

GitAtlas should remember what the corpus appears to mean, while making that understanding inspectable and refreshable as repositories change. It should help a person or coding agent avoid rebuilding existing work and avoid confusing historical, imported, vendor-derived, or overlapping repositories with the current source of truth.

## Architectural correction

The semantic intelligence should **not** be implemented as a new GitAtlas agent framework.

Use existing capable coding/research harnesses to reason over repositories and the corpus. Keep GitAtlas thin:

- prepare or hand off context;
- store/version the returned semantic artifacts;
- retain owner notes;
- track which repo revisions those artifacts describe;
- visualize/query the results.

Most semantic behaviors should begin life as versioned prompts/skills, not TypeScript agent classes or deterministic classification pipelines.

## Current phases

1. **Existing foundation:** interactive repository visualization, GitHub ingestion, metadata, technical similarity, source/dependency inspection, search, and detail views.
2. **Current milestone:** establish a thin harness handoff, build repository-understanding and estate-understanding prompts/skills, persist their outputs, and run the entire real corpus early.
3. **Corpus-driven product work:** use the real semantic output to decide the useful systems/lineage/authority UI, review workflow, owner-note UX, and refresh behavior.
4. **Later productization:** if proven useful, expose repeatable corpus-research workflows such as "Do I already have this?" directly inside GitAtlas; until then they can remain prompts/skills run through an existing harness.

The real corpus should drive later architecture. Do not pre-build a generalized ontology, semantic state machine, or agent orchestration platform around hypothetical needs.
