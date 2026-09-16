import { MAP_DEFAULT_ZOOM, MAP_FIND_MIN_ZOOM } from "@/lib/viewLimits";

export interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
  inCalifornia: boolean;
  /** Suggested map zoom for this result (city-wide vs street-level). */
  zoom: number;
  /** Nominatim place class/type when known. */
  kind?: string;
}

/** Broad places — stay pulled back so the whole city/area fits. */
const BROAD_TYPES = new Set([
  "state",
  "county",
  "region",
  "municipality",
  "city",
  "town",
  "administrative",
]);

const MID_TYPES = new Set([
  "suburb",
  "neighbourhood",
  "neighborhood",
  "quarter",
  "borough",
  "district",
  "village",
  "hamlet",
  "locality",
]);

/**
 * Pick a fly-to zoom: addresses / POIs zoom in; cities stay wider.
 * Prefer bounding-box span when Nominatim provides one.
 */
export function zoomForGeocodeResult(input: {
  class?: string | null;
  type?: string | null;
  /** Nominatim order: south, north, west, east */
  boundingbox?: string[] | null;
}): number {
  const bb = input.boundingbox;
  if (bb && bb.length >= 4) {
    const south = Number.parseFloat(bb[0]);
    const north = Number.parseFloat(bb[1]);
    const west = Number.parseFloat(bb[2]);
    const east = Number.parseFloat(bb[3]);
    if (
      Number.isFinite(south) &&
      Number.isFinite(north) &&
      Number.isFinite(west) &&
      Number.isFinite(east)
    ) {
      const span = Math.max(Math.abs(north - south), Math.abs(east - west));
      if (span > 1.2) return 9;
      if (span > 0.35) return 11;
      if (span > 0.12) return 12;
      if (span > 0.04) return 14;
      if (span > 0.012) return 16;
      if (span > 0.003) return 17;
      return 18;
    }
  }

  const cls = (input.class || "").toLowerCase();
  const typ = (input.type || "").toLowerCase();

  if (cls === "boundary" || BROAD_TYPES.has(typ)) {
    if (typ === "state" || typ === "region") return 8;
    if (typ === "county") return 10;
    return 12; // city / town / municipality
  }

  if (MID_TYPES.has(typ) || (cls === "place" && MID_TYPES.has(typ))) {
    return 14;
  }

  if (cls === "highway") return 16;

  // house, building, amenity, shop, office, etc. — zoom in for Find-ready view
  return Math.max(17, MAP_FIND_MIN_ZOOM + 1);
}

/** Client helper — hits our /api/geocode proxy (Nominatim, CA-biased). */
export async function geocodeCaliforniaPlace(
  query: string,
): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;

  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { hit?: GeocodeHit | null };
  const hit = data.hit ?? null;
  if (!hit) return null;
  return {
    ...hit,
    zoom:
      Number.isFinite(hit.zoom) && hit.zoom > 0
        ? hit.zoom
        : MAP_DEFAULT_ZOOM,
  };
}
