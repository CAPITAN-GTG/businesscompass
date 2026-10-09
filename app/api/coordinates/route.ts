import { NextRequest, NextResponse } from "next/server";
import { resolveCoordinates } from "@/lib/coordinates/resolve";
import type { CoordinateLookup } from "@/lib/coordinates/resolve";

export const dynamic = "force-dynamic";

const MAX_RECORDS = 100;

function asLookup(value: unknown): CoordinateLookup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const street = typeof row.streetAddress === "string" ? row.streetAddress.trim() : "";
  if (!street || street.length > 200) return null;
  const city = typeof row.city === "string" ? row.city.slice(0, 80) : null;
  const zip = typeof row.zipCode === "string" ? row.zipCode.slice(0, 12) : null;
  const latitude = typeof row.latitude === "number" ? row.latitude : null;
  const longitude = typeof row.longitude === "number" ? row.longitude : null;
  return {
    streetAddress: street,
    city,
    zipCode: zip,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const raw = (body as { records?: unknown })?.records;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RECORDS) {
    return NextResponse.json(
      { error: `Send 1 to ${MAX_RECORDS} address records.` },
      { status: 400 },
    );
  }

  const lookups = raw
    .map(asLookup)
    .filter((item): item is CoordinateLookup => item !== null);
  if (lookups.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await resolveCoordinates(lookups);
  return NextResponse.json({
    results: results.map((item) => ({
      key: item.key,
      latitude: item.latitude,
      longitude: item.longitude,
      coordinateSource: item.coordinateSource,
      coordinateConfidence: item.coordinateConfidence,
      usable: item.usable,
    })),
  });
}
