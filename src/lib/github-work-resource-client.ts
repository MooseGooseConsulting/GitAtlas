import { getGithubHeaders } from "./github-token";

/**
 * Canonical paginated GitHub collection reads for work resources.
 *
 * Why this file exists: every work-resource collection (issues, pulls,
 * branches, commits, deployments) follows the provider's
 * `/repositories/<id>/<collection>` pagination. The pagination contract is
 * strict — a `rel="next"` link is followed only when it names the exact same
 * canonical collection with the exact same page size (otherwise the provider
 * moved us off-scope and we fail instead of silently mixing collections).
 *
 * Retention rule: when a later page fails, `GithubWorkResourceError` carries
 * the already-fetched items and the completed page count, so the caller can
 * persist page 1+ and mark the scope `partial` instead of discarding them.
 */

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchedPages {
  items: Record<string, unknown>[];
  pagesFetched: number;
}

export class GithubWorkResourceError extends Error {
  status: number;
  code: string;
  pagesFetched: number;
  fetchedItems: Record<string, unknown>[];
  retryAt: string | null;

  constructor(
    status: number,
    code: string,
    pagesFetched = 0,
    retryAt?: string | null,
    fetchedItems: Record<string, unknown>[] = [],
  ) {
    super(`GitHub request failed (${status}, ${code})`);
    this.name = "GithubWorkResourceError";
    this.status = status;
    this.code = code;
    this.pagesFetched = pagesFetched;
    this.fetchedItems = fetchedItems;
    this.retryAt = retryAt ?? null;
  }
}

function collectionKey(path: string): string | null {
  const match = path.match(/^\/repositories\/(\d+)\/([a-z_]+)$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function tailCollection(path: string): string | null {
  const match = path.match(/\/([a-z_]+)$/);
  return match ? match[1] : null;
}

/**
 * Validate a `rel="next"` link against the canonical contract: same origin,
 * same collection (either the identical pathname, or the canonical
 * `/repositories/<repositoryId>/<collection>` form GitHub returns for a
 * `/repos/<owner>/<repo>/<collection>` first page), and the same page size
 * (missing `per_page` defaults to 100 on both sides).
 */
function sameCanonicalNext(
  firstPath: string,
  firstPerPage: string,
  repositoryId: number | undefined,
  href: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.origin !== "https://api.github.com") return false;
  let expectedPathname: string;
  try {
    expectedPathname = new URL(`https://api.github.com${firstPath}`).pathname;
  } catch {
    return false;
  }
  if (parsed.pathname !== expectedPathname) {
    // Accept GitHub's canonical `/repositories/<id>/<collection>` form when
    // the caller supplied the repository id and the collection matches.
    const expectedCollection = tailCollection(expectedPathname);
    if (
      repositoryId === undefined ||
      expectedCollection === null ||
      collectionKey(parsed.pathname) !== `${repositoryId}/${expectedCollection}`
    ) {
      return false;
    }
  }
  return (parsed.searchParams.get("per_page") ?? "100") === firstPerPage;
}

function rateLimitedRetryAt(response: Response): {
  limited: boolean;
  retryAt?: string;
} {
  if (response.status === 429) {
    return { limited: true, retryAt: retryAtOf(response) };
  }
  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining === "0" || retryAfter !== null || reset !== null) {
      return { limited: true, retryAt: retryAtOf(response) };
    }
  }
  return { limited: false };
}

function retryAtOf(response: Response): string | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return new Date(Date.now() + seconds * 1000).toISOString();
    }
    const parsed = new Date(retryAfter);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return new Date(epochSeconds * 1000).toISOString();
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch every page of a canonical `/repositories/<id>/<collection>` URL.
 * Follows only `rel="next"` links that name the same canonical collection
 * with the same `per_page`; anything else fails with `invalid_pagination`
 * while retaining the fetched items. A 404 reports the scope as unsupported
 * via `onUnsupported` (no throw — returns what was fetched so far).
 * Exhausted 5xx/network fails with `provider_failure` retaining fetched
 * items; exhausted quota fails with `rate_limited` retaining fetched items
 * plus `retryAt`.
 */
export async function fetchPages(
  path: string,
  fetchImpl: FetchFunction = fetch,
  onUnsupported?: () => void,
  repositoryId?: number,
  maxRetries = 2,
  retryDelayMs = 750,
): Promise<FetchedPages> {
  if (!process.env.GITHUB_READ_TOKEN_GITATLAS) {
    throw new GithubWorkResourceError(401, "missing_token");
  }
  if (repositoryId !== undefined) {
    void repositoryId;
  }

  const items: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let next: string | null = `https://api.github.com${path}`;
  let firstPerPage: string | null = null;

  while (next) {
    let response: Response | null = null;
    let terminalError: GithubWorkResourceError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(retryDelayMs);
      try {
        response = await fetchImpl(next, {
          headers: {
            ...getGithubHeaders(),
            Authorization: `Bearer ${process.env.GITHUB_READ_TOKEN_GITATLAS}`,
          },
        });
      } catch {
        response = null;
        terminalError = new GithubWorkResourceError(
          503,
          "provider_failure",
          pagesFetched,
          undefined,
          items,
        );
        continue;
      }

      if (response.status === 404) {
        onUnsupported?.();
        return { items, pagesFetched };
      }

      const { limited, retryAt } = rateLimitedRetryAt(response);
      if (limited) {
        throw new GithubWorkResourceError(
          response.status,
          "rate_limited",
          pagesFetched,
          retryAt,
          items,
        );
      }

      if (response.ok) {
        terminalError = null;
        break;
      }

      if (
        attempt < maxRetries &&
        (response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504 ||
          response.status === 403)
      ) {
        terminalError = new GithubWorkResourceError(
          503,
          "provider_failure",
          pagesFetched,
          undefined,
          items,
        );
        continue;
      }

      throw new GithubWorkResourceError(
        503,
        "provider_failure",
        pagesFetched,
        undefined,
        items,
      );
    }

    if (!response || !response.ok) {
      throw (
        terminalError ??
        new GithubWorkResourceError(
          503,
          "provider_failure",
          pagesFetched,
          undefined,
          items,
        )
      );
    }

    if (firstPerPage === null) {
      try {
        firstPerPage = new URL(next).searchParams.get("per_page") ?? "100";
      } catch {
        throw new GithubWorkResourceError(
          502,
          "invalid_pagination",
          pagesFetched,
          undefined,
          items,
        );
      }
    }

    const page = (await response.json()) as unknown;
    if (!Array.isArray(page)) {
      throw new GithubWorkResourceError(
        503,
        "provider_failure",
        pagesFetched,
        undefined,
        items,
      );
    }
    items.push(...(page as Record<string, unknown>[]));
    pagesFetched += 1;

    const link = response.headers.get("link");
    const segment = link
      ?.split(",")
      .find((part) => part.includes('rel="next"'));
    const href = segment?.match(/<([^>]+)>/)?.[1];
    if (!href) {
      next = null;
      continue;
    }
    if (!sameCanonicalNext(path, firstPerPage, repositoryId, href)) {
      throw new GithubWorkResourceError(
        502,
        "invalid_pagination",
        pagesFetched,
        undefined,
        items,
      );
    }
    next = href;
  }

  return { items, pagesFetched };
}
