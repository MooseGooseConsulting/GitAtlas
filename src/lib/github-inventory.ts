import { db } from "./db";

/**
 * Paginated GitHub inventory reads (the "what repositories can this token
 * see" listing plus default-branch head SHAs).
 *
 * Why this file exists: `github-inventory-sync.ts` persists inventory state,
 * but the provider reads themselves — paginated `/user/repos` listing with
 * bounded transient retries, rate-limit deferral (never spin against a 429),
 * and single-commit default-branch head lookups — live here so both the sync
 * path and the corpus validators share one honest implementation.
 *
 * Rules honored: server-side `GITHUB_READ_TOKEN_GITATLAS` only (never
 * logged or returned), `Link: rel="next"` pagination is followed verbatim
 * (absolute or relative), transient 5xx/network failures retry at most
 * MAX_RETRIES times, rate limits surface as `rate_limited` with a computed
 * `retryAt` instead of retrying, and a 404 on the listing means the scope is
 * unavailable (last-good state is retained by the caller, never erased).
 */

const GITHUB_API_BASE = "https://api.github.com";
const LISTING_PATH =
  "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 750;

export type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GithubRepositoryOwner {
  login?: string;
  type?: string;
  avatar_url?: string | null;
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  html_url: string;
  homepage?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  created_at: string;
  updated_at: string;
  pushed_at?: string | null;
  topics?: string[];
  fork?: boolean;
  archived?: boolean;
  private?: boolean;
  visibility?: string | null;
  owner?: GithubRepositoryOwner;
  default_branch?: string | null;
  /** Populated by the refresh path, not by the provider listing. */
  default_branch_head_sha?: string | null;
}

export interface FetchInventoryOptions {
  retryDelayMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchImpl;
}

export interface AccessibleInventory {
  repositories: GithubRepository[];
  pagesFetched: number;
  fetchedAt: Date;
  /**
   * True when the provider still advertises a `rel="next"` page after the
   * bounded page cap. Callers must report deferred/partial, never current.
   * Optional so previously-constructed inventories keep type-checking.
   */
  truncated?: boolean;
}

export type InventoryErrorCode =
  | "rate_limited"
  | "scope_unavailable"
  | "auth_failure"
  | "provider_failure"
  | "transient_failure"
  | "invalid_head_response"
  | "head_sync_failure"
  | "sync_failure";

export interface GithubInventoryErrorOptions {
  status?: number;
  code: InventoryErrorCode;
  pagesFetched?: number;
  retryAt?: string | Date | null;
}

export class GithubInventoryError extends Error {
  code: InventoryErrorCode;
  status: number;
  retryAt: string | null;
  pagesFetched: number;

  constructor(options: GithubInventoryErrorOptions) {
    super(`GitHub inventory request failed (${options.code})`);
    this.name = "GithubInventoryError";
    this.code = options.code;
    this.status = options.status ?? (options.code === "rate_limited" ? 429 : 503);
    this.retryAt =
      options.retryAt instanceof Date
        ? options.retryAt.toISOString()
        : (options.retryAt ?? null);
    this.pagesFetched = options.pagesFetched ?? 0;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_READ_TOKEN_GITATLAS ?? "";
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitAtlas",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function parseRetryAt(response: Response): Date | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(Date.now() + seconds * 1000);
    }
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return new Date(epochSeconds * 1000);
    }
  }
  return null;
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status === 403) {
    if (response.headers.get("retry-after") !== null) return true;
    if (response.headers.get("x-ratelimit-remaining") === "0") return true;
  }
  return false;
}

function isTransientStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function nextPagePath(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const segment = linkHeader
    .split(",")
    .find((part) => part.includes('rel="next"'));
  const href = segment?.match(/<([^>]+)>/)?.[1];
  if (!href) return null;
  try {
    const url = new URL(href, GITHUB_API_BASE);
    if (url.origin !== GITHUB_API_BASE) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

async function requestWithRetries(
  url: string,
  options: FetchInventoryOptions,
  pagesFetched: number,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: authHeaders() });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (isRateLimited(response)) {
      const retryAtDate = parseRetryAt(response);
      throw new GithubInventoryError({
        status: response.status,
        code: "rate_limited",
        pagesFetched,
        retryAt: retryAtDate ? retryAtDate.toISOString() : null,
      });
    }
    if (response.status === 404) {
      throw new GithubInventoryError({
        status: 404,
        code: "scope_unavailable",
        pagesFetched,
      });
    }
    if (response.status === 401) {
      throw new GithubInventoryError({
        status: 401,
        code: "auth_failure",
        pagesFetched,
      });
    }
    if (isTransientStatus(response.status)) {
      lastError = new GithubInventoryError({
        status: response.status,
        code: "transient_failure",
        pagesFetched,
      });
      continue;
    }
    if (!response.ok) {
      throw new GithubInventoryError({
        status: response.status,
        code: "provider_failure",
        pagesFetched,
      });
    }
    return response;
  }

  if (lastError instanceof GithubInventoryError) throw lastError;
  throw new GithubInventoryError({
    code: "transient_failure",
    pagesFetched,
  });
}

/**
 * Fetch every repository the configured token can see, following the
 * provider's `rel="next"` links. Throws `GithubInventoryError` (never
 * returns partial data) so callers retain last-good state on failure.
 */
export async function fetchAccessibleRepositories(
  options: FetchInventoryOptions = {},
): Promise<AccessibleInventory> {
  const repositories: GithubRepository[] = [];
  let next: string | null = LISTING_PATH;
  let pagesFetched = 0;
  let truncated = false;
  const seen = new Set<string>();

  while (next) {
    if (seen.has(next)) break;
    seen.add(next);
    const response = await requestWithRetries(
      new URL(next, GITHUB_API_BASE).toString(),
      options,
      pagesFetched,
    );
    const page = (await response.json()) as unknown;
    if (!Array.isArray(page)) {
      throw new GithubInventoryError({
        status: 200,
        code: "provider_failure",
        pagesFetched,
      });
    }
    repositories.push(...(page as GithubRepository[]));
    pagesFetched++;
    next = nextPagePath(response.headers.get("link"));
    if (pagesFetched >= 100) {
      // Bounded page cap: if the provider still advertises more, the
      // listing is incomplete and must surface as deferred/partial.
      truncated = next !== null;
      break;
    }
  }

  return { repositories, pagesFetched, fetchedAt: new Date(), truncated };
}

function encodeBranchRef(branch: string): string {
  return branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export interface DefaultBranchHead {
  sha: string | null;
  /** True when the provider has no committable head (empty repo, etc.). */
  unsupported: boolean;
}

/**
 * Resolve the head SHA of a repository's default branch via a single-commit
 * read. Returns `{ sha: null, unsupported: true }` when the provider reports
 * the ref as unavailable via the listing path's 404 scope guard or a
 * 404/409/422 on the commits read (missing ref, empty repository, archived
 * edge cases); rate limits and exhausted transient failures throw so the
 * caller can defer the whole refresh instead of recording a false head.
 */
export async function fetchDefaultBranchHead(
  owner: string,
  repo: string,
  branch: string,
  options: FetchInventoryOptions = {},
): Promise<DefaultBranchHead> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeBranchRef(branch)}?per_page=1`;
  const response = await requestWithRetries(
    new URL(path, GITHUB_API_BASE).toString(),
    options,
    0,
  ).catch((error: unknown) => {
    // 404/409/422 all mean "no committable head here" (missing ref, empty
    // repository, archived edge cases). Map every one to unsupported so a
    // 404 never reads as a provider error, per the function contract.
    if (
      error instanceof GithubInventoryError &&
      (error.status === 404 || error.status === 409 || error.status === 422)
    ) {
      return null;
    }
    throw error;
  });
  if (response === null) return { sha: null, unsupported: true };

  const body = (await response.json()) as unknown;
  const commit = Array.isArray(body) ? body[0] : body;
  const sha =
    commit !== null &&
    typeof commit === "object" &&
    typeof (commit as { sha?: unknown }).sha === "string"
      ? ((commit as { sha: string }).sha as string)
      : null;
  if (!sha) return { sha: null, unsupported: true };
  return { sha, unsupported: false };
}

/**
 * Consumer spelling used by `github-inventory-sync.ts` and its tests:
 * returns the head SHA (or null when unavailable). Rate-limit deferrals and
 * exhausted transient failures throw `GithubInventoryError`.
 */
export async function fetchDefaultBranchHeadSha(
  fullName: string,
  branch: string,
  options: FetchInventoryOptions = {},
): Promise<DefaultBranchHead> {
  const slash = fullName.indexOf("/");
  const owner = slash >= 0 ? fullName.slice(0, slash) : fullName;
  const repo = slash >= 0 ? fullName.slice(slash + 1) : fullName;
  return fetchDefaultBranchHead(owner, repo, branch, options);
}

export { db };
