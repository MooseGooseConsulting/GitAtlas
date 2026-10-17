# GitAtlas Recovery Status

**Date:** 2026-10-16
**Scope:** `destination/` checkout, branch `instance-1/pr-stack-db`
**Source drafts:** `handoff/docs-draft/RECOVERY-STATUS.md` + `handoff/docs-draft/INTEGRATION-outline.md` (staging only, 2026-10-16)
**Note:** First destination doc edit. `docs/architecture.md` intentionally untouched (known 10-line drift stub — keep stub + links). `README.md` is absent in this checkout (verified 2026-10-16), so the README-recovery section lives here (§8) until a root README is created. No changes to `ci.yml` / `AGENTS.md` / `architecture.md` / `reviews/` in this edit.

## 1. Recovery / integration status

Recovery checkout (`recovery/`, HEAD `745557d`) holds the Factory-built GitAtlas work-state (portfolio-first topology + work-state interface). Destination (`destination/`, HEAD `ec771f0` at draft time) is the pre-implementation base `745557d` plus 2 commits (`5e44bb2` UI/UX product review, `ec771f0` self-hosted runner fix) — it does **not** yet contain the Factory implementation.

Destination doc-state observed 2026-10-16:

- `README.md` — **MISSING** (see §8).
- `docs/architecture.md` — 10-line **stub** ("does not describe the current system", moved from `docs/plan.md`). Left as-is by this edit.
- `docs/thoughts.md` — product-goal notes only (Phases 1–2 DONE, Phase 3 IN PROGRESS, Phase 4 FUTURE); no implementation description.
- `AGENTS.md` — 8-line stub pointing at the architecture stub + UI review. Untouched.
- `prisma/schema.prisma` — still `provider = "sqlite"`, `url = env("DATABASE_URL")` (handoff migrates to PostgreSQL).
- `package.json` scripts lack the handoff DB workflow (`db:migrate`, `db:import-sqlite`, `db:test-migration`, `db:test-semantic`, `db:test-estate`, `test:integration`, `format:check`).

## 2. Provenance

- Factory session: `3341240b-eace-4c9c-9ae6-82fdd43008e3` (source: `handoff/artifacts/services.yaml` web start/stop paths).
- Events: **631 / 2327** (per task brief; capture ledger `shard-schema-replay-ledger.json` records 225 schema-shard events of 204 capture paths as one shard slice).
- Commits: **17** (Factory implementation commits on top of base; recovery HEAD pinned at base `745557d` per replay scope).
- Baselines: `745557d` (pre-implementation base, = recovery HEAD, = `factory-brain.md` source pin) → `ec771f0` (destination HEAD; brief cites `ec771f09` — same short-SHA family, verify on apply).
- Handoff generated: `2026-10-16T11:00:46Z` (`acceptance-results.skeleton.json`, `secrets-scan.json`).
- Target spec: `handoff/artifacts/architecture.md` (portfolio-first topology + work-state, Next.js/React cockpit, Zustand, Prisma/PostgreSQL, GitHub import routes, OpenRouter `:free`-only LLM client, Bun sync worker, milestones 1–3).

## 3. Capabilities ported (features.json — 26/26 `completed`)

- **Foundation:** `baseline-toolchain` (Vitest one-shot, tsc repair, formatter, PG fixtures, `bun.lock` preserved).
- **Corpus/ingestion:** `postgres-migration` (VAL-CORPUS-001), `complete-incremental-inventory` (VAL-CORPUS-002/003/005/006/007), `work-resource-snapshots` (VAL-CORPUS-004/WORK-002/003), plus repairs `corpus-import-and-partial-state-fix`, `github-work-pagination-and-commit-fix` (canonical `/repositories/<id>/<collection>` `rel=next` pagination, commit message/date mapping, partial/unsupported honesty).
- **Semantic/work-state:** `versioned-free-semantic-analysis` (server-side catalog-verified `:free` OpenRouter route, e.g. `google/gemma-4-26b-a4b-it:free`; quota-aware backlog, revision history, owner notes), `estate-synthesis-and-work-relationships` (typed explicit/inferred/heuristic edges with evidence/confidence; evidence-derived attention/active/recent/blocked/ready/stale queues), plus repairs `control-semantic-coverage-and-freshness-fix`, `control-pr-ref-evidence-fix` (`pull_request.head.ref` → `refName` for ready-to-land), `control-retained-scope-label-fix`, `control-semantic-cursor-and-estate-read-fix`, `control-estate-all-citations-fix`.
- **UI:** `portfolio-work-overview` (portfolio-first landing, 401-safe sync, retained-vs-empty states), `topology-drilldown-and-palette` (graph/grid/timeline reuse, shared light/dark palette, honest empty-heuristic state), plus round-1 UT repairs `control-reference-and-legend-fix` (VAL-UI-003/005), `control-work-search-and-pointer-fix` (VAL-UI-006), `control-narrow-toolbar-and-graph-fix` (VAL-UI-008, 390px reachability).
- **Deployment/workflow:** `production-quality-gates` (formatter/lint/strict-tsc/unit + isolated PG integration + Next build, no suppressed type errors), `production-image-and-health` (secret-free image, health endpoint, runtime-only DB validation, restart-safe worker wiring estate + edge refresh), `homelab-deployment-proposal` (unmerged homelab-next PR, CNPG `pg18-core` role/DB, Doppler secrets, Tailscale-private ingress, no public route), `readme-issues-and-prs` (README + issue/PR linkage #9–#19, #33, #34, homelab-next#301).
- **Deterministic gates (control-surface scrutiny round 5, pass):** `bun run test` exit 0 (27 files / 245 tests), `bunx tsc --noEmit` exit 0, `bun run lint` exit 0; 3/3 fix reviews pass.

## 4. Acceptance state — 23 passed / 5 failed / 7 pending

Source: `handoff/artifacts/validation-state.json` (35 keys) vs `validation-contract.md` (34 headers — **VAL-CORPUS-004 has no contract header**, state-only key; behavior must be reconstructed from `work-resource-snapshots` + r1 failure text before revalidation).

- **Passed (23):** VAL-CORPUS-001/002/003/004/005/006/007, VAL-SEM-001–006, VAL-WORK-001/002/003, VAL-UI-001/002/004, VAL-CROSS-001/002/003/004. (CROSS-003 evidence note: r1 basis was a disposable-schema SyncState update, not a real failing provider refresh — weak-evidence, re-observe live fault path.)
- **Failed / stale (5, all VAL-UI round-1 records):** VAL-UI-003 (unresolved refs filtered by `targetResourceId IS NOT NULL`), VAL-UI-005 (graph legend missing provenance categories), VAL-UI-006 (work-title search + `#tour-graph-area` pointer interception), VAL-UI-007 (blocked: empty/pending/failed-refresh states unavailable live), VAL-UI-008 (390px controls clipped). **Superseded by later evidence, NOT written back to state** (per `validation-state.json.provenance.json` discrepancy field).
- **Pending (7):** VAL-DEP-001–006 + VAL-CROSS-005. Features `production-quality-gates`, `production-image-and-health`, `homelab-deployment-proposal`, `readme-issues-and-prs` are marked `completed` in `features.json` but state was never updated — **first-run required** on recovery SHA (CI gates, docker build/start + sensitive-path inspection, health/restart, config/failure matrix, homelab PR URL/diff/checks, PR URLs + issue links + README diff).

Gaps summary:

1. **Round-2 synthesis missing from state:** `portfolio-ui.json` (round-2 flow, tested 2026-10-12T05:12:00Z, isolated schema `gitatlas_ut_ctrl_ui_r2`, 141 projects) records **8/8 UI pass** (VAL-UI-001–008), and scrutiny round 5 passes — neither wrote back to `validation-state.json`. Recovery must **re-run browser flows on the new SHA**, not trust ported `failed`.
2. **VAL-UI stale:** see (1); VAL-UI-007 r2 pass relied on seeded beta/gamma fixtures + a temporary `/api/portfolio` empty-corpus mock (unrouted after) — no live empty-corpus / live failed-refresh observation exists; re-exercise deterministic fixtures explicitly.
3. **VAL-DEP pending:** all deployment assertions unexecuted in state; run per contract Tool column (`bun`, `sudo docker`, `curl`, `psql`, `git`/`gh`) and record commands, exit codes, totals, PR URLs.

Full per-assertion field contract + ported evidence paths: `handoff/acceptance-results.skeleton.json` (skeleton only — `testedSha`/`command`/`actual` all null; **no test executed on recovery SHA yet**).

## 5. DB migration notes (SQLite → PostgreSQL)

- Procedure (from `handoff/stage-runtime/docs/postgresql-migration.md` + `library/postgres-migration.md`): `bun run db:migrate` → `bun run db:import-sqlite` (read-only legacy source, one PG transaction, preserves original IDs; same-ID rows skipped and reported as divergent, never overwritten; different-ID natural-key collision fails transactionally) → `bun run db:test-migration` (process-unique `gitatlas_verify_<uuid>` schema, double-migrate, rerun/changed-row/conflict/CRUD checks, schema dropped; never writes live schema). `LEGACY_SQLITE_PATH` overrides source; `GITATLAS_DATABASE_URL` selects target (not `DATABASE_URL`); SQLite URLs rejected in production.
- Test isolation: per `factory-brain.md` + redaction policy — disposable test DB on **`localhost:5433` / `gitatlas_test_1`** (`postgresql://postgres:test@localhost:5433/gitatlas_test_1`); dev fallback is `gitatlas_dev` via `/run/postgresql` socket :5432; round-2 UI used schema `gitatlas_ut_ctrl_ui_r2`. Direct `bunx prisma …` fails P1012 under tracked `.env`'s legacy `DATABASE_URL="file:./db/custom.db"` — use the `bun run db:*` wrappers.
- Destination gap: still SQLite + legacy scripts; migration workflow, `resolveDatabaseUrl()`, and `.zscripts` PG guards are part of the port (see INTEGRATION outline source draft).
- Reference local counts (2026-09-30, informational): Project 29, AnalysisJob 3, CommitActivityCache 1, RecentCommitsCache 0; 13/29 legacy Projects refreshed-divergent.

## 6. Secrets policy

Per `handoff/redaction-policy.md` (287 records / 548 replacements; evidence READ-ONLY, substitutions to live replay copies only, never back into evidence) and `secrets-scan.json`:

- Replay substitutions: DB → explicit safe test value (`:5433/gitatlas_test_1`); GitHub/PAT, `GITATLAS_INTERNAL_SYNC_TOKEN`, OpenRouter/provider keys, Factory `fk-…`, JWTs, private-key blocks → **env references** (`${GITHUB_TOKEN}`, `${GITATLAS_INTERNAL_SYNC_TOKEN}`, `${OPENROUTER_API_KEY:-UNSET}`, `${FACTORY_API_KEY:-UNSET}`), never hardcoded or exported into shell history; free-tier OpenRouter only (`OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `openrouter:free` tier, primary `google/gemma-4-26b-a4b-it:free`, no paid fallback); safe literals only for origin/env/sqlite-path (`http://localhost:3100`, `test`, `./.tmp/replay.sqlite`). Never execute recorded `command` strings with embedded `Authorization` headers — reconstruct with `${…}`. Re-run `scan_credentials.py` + Gitleaks after substitution; expect zero findings.
- Destination hygiene flags (owner decision, **no rotation/removal in this handoff**): tracked `.env` (740B, mode 100755, since `e51e1dd`; `.gitignore` `.env*` does not cover tracked files — scanner found no credential-shaped values repo-wide; verify placeholders, then `git rm --cached` + rotate any real values or document opt-in exception); 33× `qa-*.png` tracked under `download/` (committed QA screenshots, not ignored); tracked 25M `workspace-*.tar`; dirty `M bun.lock` (95+/27-; pre-existing edit preserved per feature contracts). Do NOT push/clone to untrusted remotes until `.env` resolved.

## 7. Next goals (measurable, linked)

1. **Revalidate UI on recovery SHA, close stale VAL-UI-003/005/006/007/008** — agent-browser 8/8 pass incl. 390×844 viewport + deterministic empty/pending/failed fixtures; update `validation-state.json` with `testedSha`/commands/evidence. (Issues: roadmap #9–#19 UI milestones; palette #33.)
2. **Execute VAL-DEP-001 (deterministic CI gates) green** — formatter, ESLint, strict `tsc --noEmit`, one-shot unit (≥245 tests), isolated PG integration, production Next build, all exit 0 with exact commands/exit-codes/totals recorded in GitAtlas PR.
3. **Execute VAL-DEP-002/003/004 + CROSS-005 (image → local readiness)** — secret-free image builds/starts (sensitive-path inspection, no `.env`/SQLite/archive/keys), health succeeds/fails meaningfully, restart retains IDs/state on :3100, runtime config matrix + sanitized logs, zero paid model calls.
4. **Land traceable handoff PRs (VAL-DEP-006 + VAL-DEP-005)** — unmerged GitAtlas + homelab-next PRs linking #9–#19, #33, #34, homelab-next#301; README diff covering migration, runtime env names, checks/image/health, worker restart/partial state, deferred rollout; record both PR URLs + CI status. (Image asset issue #34; homelab #301.)
5. **Reconcile contract gap VAL-CORPUS-004** — reconstruct Behavior/Tool/Evidence from `work-resource-snapshots` + corpus UT r1/r2, add the missing contract header, and revalidate paginated observable-resource persistence (issues/PRs/branches/commits/deployments) against a bounded live sample.

## 8. README-recovery section (root README.md absent)

`README.md` does not exist in this checkout, so this section stands in for the README recovery note until a root README is authored (per INTEGRATION outline: setup, migration, runtime env *names*, commands, health, worker restart/partial-state, limitations, deferred rollout):

- **What this repo state is:** pre-implementation base + 2 destination commits; Factory work-state lands via `instance-1/`-prefixed branches/PRs (see INTEGRATION outline draft §§1–2: prereqs Bun 1.4 / PG16, `GITATLAS_DATABASE_URL`, `db:migrate` → `db:import-sqlite` → `db:test-migration`, gates, :3100 run, secret-free image).
- **Do not rely on:** `docs/architecture.md` stub, `AGENTS.md` stub, missing README, SQLite default — all pending replacement during cutover.
- **Next doc step:** author root README + replace architecture/AGENTS stubs at cutover time; keep `docs/postgresql-migration.md` (already in `docs/`) as the migration reference.

## 9. Integration pointer

Landing procedure, consumer cutover (Prisma/PostgreSQL snapshot + per-resource sync state via `/api/portfolio`, `/api/github/projects?username=all`, `/api/work/resources`, `/api/relationships`, `/api/estate`; `GITATLAS_INTERNAL_SYNC_TOKEN` auth boundary), remaining runtime work, hygiene, and deferred items are detailed in the staging outline `handoff/docs-draft/INTEGRATION-outline.md`. No `INTEGRATION.md` created by this edit — promote that outline at cutover time.
