import { NextRequest, NextResponse } from "next/server";
import { EXTERNAL_USER_AGENT } from "@/lib/external";
import {
  CA_EAST,
  CA_NORTH,
  CA_SOUTH,
  CA_WEST,
  isInCalifornia,
} from "@/lib/geo";
import { zoomForGeocodeResult } from "@/lib/geocode";

export const dynamic = "force-dynamic";

const GEOCODE_TIMEOUT_MS = 8_000;
const GEOCODE_HIT_TTL_MS = 24 * 60 * 60 * 1000;
const GEOCODE_MISS_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_MAX = 100;

type NominatimRow = {
  lat: string;
  lon: string;
  display_name?: string;
  class?: string;
  type?: string;
  boundingbox?: string[];
};

interface GeocodeCacheEntry {
  expiresAt: number;
  rows: NominatimRow[];
}

const geocodeCache = new Map<string, GeocodeCacheEntry>();
const geocodeInflight = new Map<string, Promise<NominatimRow[]>>();

async function nominatimSearch(
  params: URLSearchParams,
): Promise<NominatimRow[]> {
  const key = params.toString();
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    geocodeCache.delete(key);
    geocodeCache.set(key, cached);
    return cached.rows;
  }
  if (cached) geocodeCache.delete(key);

  const pending = geocodeInflight.get(key);
  if (pending) return pending;

  const job = requestNominatim(key, params).finally(() => {
    geocodeInflight.delete(key);
  });
  geocodeInflight.set(key, job);
  return job;
}

async function requestNominatim(
  key: string,
  params: URLSearchParams,
): Promise<NominatimRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": EXTERNAL_USER_AGENT,
        },
        cache: "no-store",
      },
    );
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Nominatim ${res.status}`);
    }
    if (!res.ok) return [];
    const rows = (await res.json()) as NominatimRow[];
    const list = Array.isArray(rows) ? rows : [];
    rememberGeocode(
      key,
      list,
      list.length ? GEOCODE_HIT_TTL_MS : GEOCODE_MISS_TTL_MS,
    );
    return list;
  } finally {
    clearTimeout(timer);
  }
}

function rememberGeocode(key: string, rows: NominatimRow[], ttl: number): void {
  geocodeCache.set(key, { expiresAt: Date.now() + ttl, rows });
  while (geocodeCache.size > GEOCODE_CACHE_MAX) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest === undefined) break;
    geocodeCache.delete(oldest);
  }
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!q || q.length > 200) {
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

  try {
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
  } catch {
    return NextResponse.json(
      { error: "Place search is temporarily unavailable." },
      { status: 503 },
    );
  }
}
