import { NextRequest, NextResponse } from "next/server";
import { isLocationAccount } from "@/lib/locationAccount";
import { loadBusinessDetail } from "@/lib/businessDetail";
import {
  LosAngelesDataUnavailableError,
  withLaErrorHandling,
} from "@/lib/sources/losAngelesBusinesses";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const decoded = decodeURIComponent(id).trim();

  if (!isLocationAccount(decoded)) {
    return NextResponse.json({ error: "Invalid business id." }, { status: 400 });
  }

  try {
    const { business, enrichment } = await withLaErrorHandling(() =>
      loadBusinessDetail(decoded),
    );

    if (!business || !enrichment) {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }

    return NextResponse.json({
      business,
      enrichment,
    });
  } catch (err) {
    const message =
      err instanceof LosAngelesDataUnavailableError
        ? "Los Angeles business data is temporarily unavailable."
        : "Los Angeles business data is temporarily unavailable.";

    return NextResponse.json({ error: message }, { status: 503 });
  }
}
