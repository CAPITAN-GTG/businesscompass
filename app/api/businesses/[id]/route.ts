import { NextRequest, NextResponse } from "next/server";
import {
  LosAngelesDataUnavailableError,
  withLaErrorHandling,
} from "@/lib/sources/losAngelesBusinesses";
import { defaultSource } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const decoded = decodeURIComponent(id);

  try {
    const business = await withLaErrorHandling(() =>
      defaultSource.getById(decoded),
    );

    if (!business) {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }

    return NextResponse.json({
      business,
      source: defaultSource.meta,
    });
  } catch (err) {
    const message =
      err instanceof LosAngelesDataUnavailableError
        ? "Los Angeles business data is temporarily unavailable."
        : "Los Angeles business data is temporarily unavailable.";

    return NextResponse.json({ error: message }, { status: 503 });
  }
}
