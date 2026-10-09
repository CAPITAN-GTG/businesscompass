import { NextRequest, NextResponse } from "next/server";
import {
  AreaTooDenseError,
  LosAngelesDataUnavailableError,
  withLaErrorHandling,
} from "@/lib/sources/losAngelesBusinesses";
import { defaultSource } from "@/lib/sources";
import { UNLOCATED_FETCH_LIMIT } from "@/lib/coordinates/config";
import { isValidMapBBox } from "@/lib/geo";
import type { BusinessQuery, BusinessSort } from "@/lib/types/business";

export const dynamic = "force-dynamic";

const VALID_SORTS: BusinessSort[] = [
  "start_date_desc",
  "start_date_asc",
  "name_asc",
  "name_desc",
];

function parseSort(value: string | null): BusinessSort {
  if (value && VALID_SORTS.includes(value as BusinessSort)) {
    return value as BusinessSort;
  }
  return "start_date_desc";
}

function parseBBox(sp: URLSearchParams): BusinessQuery["bbox"] | undefined {
  const north = Number(sp.get("north"));
  const south = Number(sp.get("south"));
  const east = Number(sp.get("east"));
  const west = Number(sp.get("west"));
  if (![north, south, east, west].every(Number.isFinite)) return undefined;
  const bbox = { north, south, east, west };
  return isValidMapBBox(bbox) ? bbox : undefined;
}

export async function GET(request: NextRequest) {
  // Map list stays lean. Phone enrichment runs only from the detail route.
  const sp = request.nextUrl.searchParams;
  const unlocated = sp.get("unlocated") === "1";
  const bbox = unlocated ? undefined : parseBBox(sp);

  // Viewport queries stream page-by-page from the client.
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const requestedSize = Math.max(1, Number(sp.get("pageSize") || "25") || 25);
  const pageSize = unlocated
    ? Math.min(UNLOCATED_FETCH_LIMIT, requestedSize)
    : Math.min(5_000, requestedSize);

  const query: BusinessQuery = {
    page,
    pageSize,
    sort: parseSort(sp.get("sort")),
    businessName: sp.get("businessName") || undefined,
    dbaName: sp.get("dbaName") || undefined,
    city: sp.get("city") || undefined,
    zipCode: sp.get("zipCode") || undefined,
    naicsOrIndustry: sp.get("naicsOrIndustry") || undefined,
    startDateFrom: sp.get("startDateFrom") || undefined,
    startDateTo: sp.get("startDateTo") || undefined,
    unlocated,
    bbox,
  };

  try {
    const result = await withLaErrorHandling(() =>
      defaultSource.list(query),
    );

    return NextResponse.json({
      ...result,
      source: defaultSource.meta,
    });
  } catch (err) {
    if (err instanceof AreaTooDenseError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "AREA_TOO_DENSE",
          totalCount: err.totalCount,
          maxAllowed: err.maxAllowed,
        },
        { status: 422 },
      );
    }

    const message =
      err instanceof LosAngelesDataUnavailableError
        ? "Los Angeles business data is temporarily unavailable."
        : "Los Angeles business data is temporarily unavailable.";

    return NextResponse.json({ error: message }, { status: 503 });
  }
}
