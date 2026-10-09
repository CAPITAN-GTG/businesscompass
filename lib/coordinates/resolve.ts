import { addressCacheKey, buildingAddressLine } from "./address.ts";
import { readCoordinateCache, writeCoordinateCache } from "./cache.ts";
import { geocodeCamsBatch } from "./cams.ts";
import {
  CAMS_BATCH_SIZE,
  COORDINATE_FAILURE_TTL_MS,
  COORDINATE_MATCH_TTL_MS,
  COORDINATE_MISS_TTL_MS,
} from "./config.ts";
import {
  decideSharedPlacement,
  type AddressParts,
  type CamsCandidate,
  type CoordinatePair,
  type Placement,
} from "./decide.ts";

export interface CoordinateLookup extends AddressParts, CoordinatePair {}

export interface CoordinateResult extends Placement {
  key: string;
}

const MAX_LOOKUPS = 100;

function ttlFor(placement: Placement, failed: boolean): number {
  if (failed) return COORDINATE_FAILURE_TTL_MS;
  if (placement.coordinateSource === "la_county_cams") return COORDINATE_MATCH_TTL_MS;
  return COORDINATE_MISS_TTL_MS;
}

/**
 * Resolve unique building addresses. Cache hits do not call CAMS.
 * A failed geocoder call keeps the Finance coordinate and is remembered briefly.
 */
export async function resolveCoordinates(
  lookups: CoordinateLookup[],
): Promise<CoordinateResult[]> {
  const limited = lookups.slice(0, MAX_LOOKUPS);
  const grouped = new Map<
    string,
    { line: string; address: AddressParts; originals: CoordinatePair[] }
  >();

  for (const lookup of limited) {
    const key = addressCacheKey(lookup);
    const line = buildingAddressLine(lookup.streetAddress);
    if (!key || !line) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.originals.push(lookup);
      continue;
    }
    grouped.set(key, {
      line,
      address: lookup,
      originals: [lookup],
    });
  }

  const results: CoordinateResult[] = [];
  const pending: Array<{
    key: string;
    line: string;
    address: AddressParts;
    originals: CoordinatePair[];
  }> = [];

  for (const [key, group] of grouped) {
    const cached = readCoordinateCache(key);
    if (cached) {
      results.push({ key, ...cached });
      continue;
    }
    pending.push({ key, ...group });
  }

  for (let offset = 0; offset < pending.length; offset += CAMS_BATCH_SIZE) {
    const chunk = pending.slice(offset, offset + CAMS_BATCH_SIZE);
    let failed = false;
    let located = new Map<number, CamsCandidate | null>();
    try {
      located = await geocodeCamsBatch(
        chunk.map((item, index) => ({
          id: index + 1,
          address: item.line,
          city: item.address.city,
          postal: item.address.zipCode,
        })),
      );
    } catch {
      failed = true;
    }

    chunk.forEach((item, index) => {
      const placement = decideSharedPlacement(
        item.originals,
        item.address,
        failed ? null : (located.get(index + 1) ?? null),
      );
      writeCoordinateCache(item.key, placement, ttlFor(placement, failed));
      results.push({ key: item.key, ...placement });
    });
  }

  return results;
}
