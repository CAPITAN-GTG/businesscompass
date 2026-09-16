export interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
  inCalifornia: boolean;
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
  return data.hit ?? null;
}
