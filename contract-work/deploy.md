### VAL-DEP-001: Reproducible quality gates
Behavior: Formatter check, ESLint, strict TypeScript check, one-shot unit and PostgreSQL integration tests, and production Next build each exit zero; type errors are not suppressed by build configuration. Any failure is reported rather than called passing.
Tool: bun
Evidence: Exact package-script commands, exit codes and test totals in the GitAtlas PR; integration test uses an isolated PostgreSQL test database/schema rather than tracked SQLite data.

### VAL-DEP-002: Secret-free production image
Behavior: Production Docker image builds and starts with runtime configuration; image context/layers do not include tracked `.env`, SQLite database/archive, token values or other private corpus data. No keys are baked into build arguments. Existing host port 3000 and unrelated services are untouched.
Tool: sudo docker
Evidence: Image-build command/result, bounded image-content inspection of sensitive paths (not secret values), and container startup result in the GitAtlas PR.

### VAL-DEP-003: Health and local HTTP readiness
Behavior: Running image exposes a health endpoint that succeeds when the configured app/database are ready and fails meaningfully when a required dependency is unavailable; local HTTP smoke test uses port 3100 without claiming cluster readiness.
Tool: sudo docker, curl
Evidence: Container run and health/HTTP commands with status codes and representative non-sensitive responses.

### VAL-DEP-004: Runtime configuration and secret boundaries
Behavior: Dedicated PostgreSQL connection and GitHub/OpenRouter credentials are supplied at runtime; missing required configuration produces an actionable failure without echoing values. Only catalog-verified free `:free` OpenRouter routes are allowed, with no paid fallback. Internal sync writes require authorization, worker target cannot be an arbitrary caller-supplied URL, and provider errors do not leak credentials in logs.
Tool: bun, sudo docker, curl
Evidence: Redacted runtime-config matrix, negative missing-config/unauthorized-write/invalid-target checks, free-model selection test, and sanitized log result in GitAtlas PR; do not print actual secrets.

### VAL-DEP-005: Migration and restart persistence
Behavior: Existing SQLite project/history data migrates non-destructively to a dedicated PostgreSQL database; migrations are repeatable, and project/sync/analysis state persists across application and worker restart. Failed refresh retains last good snapshot. No reset of unrelated local database or tracked files.
Tool: bun, sudo docker, psql
Evidence: Before/after record counts and stable IDs from an isolated migration fixture, migration rerun result, and PostgreSQL queries before/after container or process restart.

### VAL-DEP-006: Bounded worker operation
Behavior: Worker resumes incremental ingestion and pending analysis after restart, avoids duplicate records/unchanged-revision reanalysis, observes rate limits and bounded retries, and records partial failures rather than erasing previous success. Deployment uses a single app instance and a restart-safe worker strategy.
Tool: bun, psql
Evidence: One-shot worker commands/test results and sanitized database state for first run, rerun, restart, and simulated transient failure; no unbounded live API run required.

### VAL-DEP-007: Homelab deployment proposal
Behavior: An unmerged homelab-next PR follows existing conventions for a dedicated database/role on `data-platform/pg18-core`, backup convention, Doppler-backed database/GitHub/LLM secrets, private Tailscale ingress, least-privilege network boundary and single app instance. No public Cloudflare route or asserted final hostname. Manifest review/build or static checks pass where locally feasible. Live cluster rollout, hostname selection and in-cluster verification are explicitly deferred until access is attached; their absence does not fail this acceptance.
Tool: gh, bun
Evidence: homelab-next PR URL and diff/check results, with explicit deferred-rollout note; no requirement for live Kubernetes access.

### VAL-DEP-008: PR and issue traceability
Behavior: GitAtlas and homelab-next PRs are opened but not merged, link relevant issues (#9–#19, #33, #34 and homelab-next#301 as applicable), distinguish completed work from superseded/deferred work, and accurately state test outcomes and blockers. Issue/PR updates avoid claiming unavailable deployment or agent signals.
Tool: gh
Evidence: Both PR URLs, relevant issue/comment URLs and reported check status.

### VAL-DEP-009: Operator documentation
Behavior: README explains local PostgreSQL setup/migration, runtime env names without values, checks/build/image/health commands, worker restart/partial-failure behavior, private deployment proposal and deferred live rollout. It records actual outcomes and the next 3–5 highest-value follow-ups; historical tracked `.env`/SQLite/archive risks are noted for owner-coordinated decisions, without demanding history rewrite or rotation in this task.
Tool: bun, gh
Evidence: README diff in GitAtlas PR and links to the two PRs; commands match those actually exercised.
