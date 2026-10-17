import { NextRequest, NextResponse } from "next/server";
import { runEstateSynthesis } from "@/lib/estate-synthesis";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEstateSynthesis();
    return NextResponse.json({
      status: result.status,
      estateId: result.estateId ?? null,
      errorCode: result.errorCode ?? null,
      retryAt: result.retryAt ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Estate synthesis could not be completed." },
      { status: 503 },
    );
  }
}
