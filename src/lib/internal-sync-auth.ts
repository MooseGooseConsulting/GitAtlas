import { timingSafeEqual } from "node:crypto";

export function isInternalRequestAuthorized(request: Request): boolean {
  const expected = process.env.GITATLAS_INTERNAL_SYNC_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  if (!expected || !supplied.startsWith("Bearer ")) return false;
  const candidate = supplied.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}