/**
 * Relationship semantics: what a work-resource text reference *means*.
 *
 * Why this file exists: `github-work-resources.ts` extracts raw references
 * (explicit GitHub URLs vs `#123` mentions) and must record *why* the
 * reference exists — closing verbiage ("fixes #12"), dependency verbiage
 * ("blocked by ..."), or a plain mention — without ever changing the
 * referenced resource's state. The reference row carries the intent; the
 * target's `sourceState` is never touched.
 *
 * Classification rule (tested): an explicit github.com URL classifies as
 * `explicit_github_link` / `authoritative`; a `#123` text mention classifies
 * as `source_supported_inference` / `supported`. Unresolved mentions keep
 * their recorded intent with a null target identity — intent is never
 * invented, only read from the source text.
 */

export type RelationshipType = "explicit" | "inferred";

export type ReferenceIntent = "closing" | "blocking" | "reference";

export interface ReferenceClassification {
  relationshipType: RelationshipType;
  category: string;
  confidence: string;
}

export interface WorkReferenceLike {
  relationshipType: string;
  evidence: string;
  intent?: string | null;
}

const CLOSING_PATTERN =
  /\b(?:close|closes|closed|closing|fix|fixes|fixed|fixing|resolve|resolves|resolved|resolving)\b/i;
const BLOCKING_PATTERN =
  /\b(?:block|blocks|blocked|blocking|depends?\s+on|blocked\s+by|requires?)\b/i;

function sentenceAround(text: string, index: number): string {
  const boundaries = ["\n", ".", ";", "!?", "!", "?"];
  let start = 0;
  for (const boundary of boundaries) {
    const found = text.lastIndexOf(boundary, Math.max(0, index - 1));
    if (found >= 0) start = Math.max(start, found + boundary.length);
  }
  let end = text.length;
  for (const boundary of boundaries) {
    const found = text.indexOf(boundary, index);
    if (found >= 0) end = Math.min(end, found);
  }
  return text.slice(start, end);
}

/**
 * Detect the author's intent for a reference located at `index` in `text`.
 * "Fixes #12" → `closing`; "Blocked by ..." → `blocking`; anything else →
 * `reference`. Only the sentence surrounding the reference is considered so
 * a closing verb elsewhere in a long body does not leak onto other refs.
 */
export function detectReferenceIntent(
  text: string,
  index: number,
): ReferenceIntent {
  const sentence = sentenceAround(text, index);
  if (CLOSING_PATTERN.test(sentence)) return "closing";
  if (BLOCKING_PATTERN.test(sentence)) return "blocking";
  return "reference";
}

/**
 * Classify a reference into its provenance bucket. Explicit GitHub links
 * are authoritative; `#123` text mentions are source-supported inferences.
 */
export function classifyReference(
  reference: WorkReferenceLike,
): ReferenceClassification {
  if (
    reference.relationshipType === "explicit" ||
    reference.evidence === "source_url"
  ) {
    return {
      relationshipType: "explicit",
      category: "explicit_github_link",
      confidence: "authoritative",
    };
  }
  return {
    relationshipType: "inferred",
    category: "source_supported_inference",
    confidence: "supported",
  };
}
