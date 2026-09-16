/** Approximate California bounding box (WGS84). */
export const CA_SOUTH = 32.5;
export const CA_NORTH = 42.05;
export const CA_WEST = -124.5;
export const CA_EAST = -114.1;

export const CA_CENTER: [number, number] = [36.7783, -119.4179];

/** LA metro — dataset is City of LA registrations; useful default map view. */
export const LA_CENTER: [number, number] = [34.0522, -118.2437];

/** Leaflet LatLngBounds corners: SW, NE */
export const CA_BOUNDS_LEAFLET: [[number, number], [number, number]] = [
  [CA_SOUTH, CA_WEST],
  [CA_NORTH, CA_EAST],
];

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/** Geographic bounding box (WGS84). */
export interface MapBBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function isInCalifornia(latitude: number, longitude: number): boolean {
  return (
    latitude >= CA_SOUTH &&
    latitude <= CA_NORTH &&
    longitude >= CA_WEST &&
    longitude <= CA_EAST
  );
}

function roundCoord(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Round coords so tiny pan jitter does not thrash the API. */
export function normalizeMapBBox(bbox: MapBBox): MapBBox {
  return {
    north: roundCoord(bbox.north),
    south: roundCoord(bbox.south),
    east: roundCoord(bbox.east),
    west: roundCoord(bbox.west),
  };
}

export function mapBBoxKey(bbox: MapBBox | null | undefined): string {
  if (!bbox) return "";
  const n = normalizeMapBBox(bbox);
  return `${n.south},${n.west},${n.north},${n.east}`;
}

export function isValidMapBBox(bbox: MapBBox): boolean {
  return (
    Number.isFinite(bbox.north) &&
    Number.isFinite(bbox.south) &&
    Number.isFinite(bbox.east) &&
    Number.isFinite(bbox.west) &&
    bbox.north > bbox.south &&
    bbox.east > bbox.west
  );
}

/**
 * Clamp a viewport to California. Returns null if the intersection is empty
 * (e.g. map briefly outside the allowed region).
 */
export function intersectMapBBoxWithCalifornia(bbox: MapBBox): MapBBox | null {
  const next: MapBBox = {
    north: Math.min(bbox.north, CA_NORTH),
    south: Math.max(bbox.south, CA_SOUTH),
    east: Math.min(bbox.east, CA_EAST),
    west: Math.max(bbox.west, CA_WEST),
  };
  return isValidMapBBox(next) ? normalizeMapBBox(next) : null;
}
