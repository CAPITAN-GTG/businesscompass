import { NextRequest, NextResponse } from "next/server";
import {
  CA_EAST,
  CA_NORTH,
  CA_SOUTH,
  CA_WEST,
  isInCalifornia,
} from "@/lib/geo";
import { zoomForGeocodeResult } from "@/lib/geocode";

export const dynamic = "force-dynamic";

type NominatimRow = {
  lat: string;
  lon: string;
  display_name?: string;
  class?: string;
  type?: string;
  boundingbox?: string[];
};

async function nominatimSearch(
  params: URLSearchParams,
): Promise<NominatimRow[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "BusinessCompass/0.1 (https://localhost map finder)",
      },
      next: { revalidate: 0 },
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as NominatimRow[];
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }

  const labeled = /california|,\s*ca\b/i.test(q) ? q : `${q}, California`;

  const bounded = new URLSearchParams({
    q: labeled,
    format: "json",
    limit: "5",
    countrycodes: "us",
    viewbox: `${CA_WEST},${CA_NORTH},${CA_EAST},${CA_SOUTH}`,
    bounded: "1",
  });

  let rows = await nominatimSearch(bounded);

  if (!rows.length) {
    const loose = new URLSearchParams({
      q: labeled,
      format: "json",
      limit: "5",
      countrycodes: "us",
    });
    rows = await nominatimSearch(loose);
  }

  const hits = rows
    .map((r) => {
      const lat = Number.parseFloat(r.lat);
      const lng = Number.parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const zoom = zoomForGeocodeResult({
        class: r.class,
        type: r.type,
        boundingbox: r.boundingbox,
      });
      return {
        lat,
        lng,
        label: r.display_name?.trim() || q,
        inCalifornia: isInCalifornia(lat, lng),
        zoom,
        kind: [r.class, r.type].filter(Boolean).join("/"),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (!hits.length) {
    return NextResponse.json({ hit: null });
  }

  const hit = hits.find((h) => h.inCalifornia) ?? hits[0];
  return NextResponse.json({ hit });
}
