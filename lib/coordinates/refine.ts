import { ageColorBandFromStartDate } from "../ageColor.ts";
import { addressCacheKey } from "./address.ts";
import { CAMS_BATCH_SIZE, COORDINATE_REFINE_LIMIT, UNLOCATED_FETCH_LIMIT } from "./config.ts";
import { isUsableCoordinate } from "./decide.ts";
import type { Business } from "../types/business.ts";
import type { MapBBox } from "../geo.ts";
import {
  businessInBBox,
  businessesInBBoxFromAllRanks,
  mergeBusinessesIntoCache,
  replaceCachedBusiness,
  viewFilterKey,
} from "../viewCache.ts";

interface PlacementResponse {
  key: string;
  latitude: number | null;
  longitude: number | null;
  coordinateSource: "la_county_cams" | "la_office_finance";
  coordinateConfidence: "high" | "original";
  usable: boolean;
}

interface AddressGroup {
  streetAddress: string;
  city: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  businesses: Business[];
}

function parsed(business: Business): { lat: number | null; lng: number | null } {
  const lat = business.latitude ? Number.parseFloat(business.latitude) : Number.NaN;
  const lng = business.longitude ? Number.parseFloat(business.longitude) : Number.NaN;
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function applyPlacement(business: Business, placement: PlacementResponse): Business | null {
  const own = parsed(business);
  const ownUsable = isUsableCoordinate(own.lat, own.lng);

  if (
    placement.coordinateSource === "la_county_cams" &&
    placement.usable &&
    placement.latitude != null &&
    placement.longitude != null
  ) {
    return {
      ...business,
      latitude: placement.latitude.toFixed(6),
      longitude: placement.longitude.toFixed(6),
      coordinateSource: "la_county_cams",
      coordinateConfidence: "high",
    };
  }

  if (ownUsable) {
    return {
      ...business,
      coordinateSource: "la_office_finance",
      coordinateConfidence: "original",
    };
  }

  if (
    placement.usable &&
    placement.latitude != null &&
    placement.longitude != null
  ) {
    return {
      ...business,
      latitude: placement.latitude.toFixed(6),
      longitude: placement.longitude.toFixed(6),
      coordinateSource: "la_office_finance",
      coordinateConfidence: "original",
    };
  }

  return null;
}

function storeBusiness(business: Business, bbox: MapBBox): void {
  if (replaceCachedBusiness(business)) return;
  if (!businessInBBox(business, bbox)) return;
  const band = ageColorBandFromStartDate(business.businessStartDate);
  if (!band) return;
  mergeBusinessesIntoCache(viewFilterKey(band), [business]);
}

/**
 * After pins are drawn from Finance coordinates, refine unique addresses.
 * CAMS downtime leaves the original pins in place.
 */
export async function refineMapCoordinates(options: {
  bbox: MapBBox;
  signal: AbortSignal;
  onApplied: () => void;
}): Promise<void> {
  const { bbox, signal, onApplied } = options;
  let unlocated: Business[] = [];
  try {
    const params = new URLSearchParams({
      unlocated: "1",
      page: "1",
      pageSize: String(UNLOCATED_FETCH_LIMIT),
      sort: "start_date_desc",
    });
    const response = await fetch(`/api/businesses?${params}`, { signal });
    if (response.ok) {
      const data = (await response.json()) as { businesses?: Business[] };
      unlocated = Array.isArray(data.businesses) ? data.businesses : [];
    }
  } catch {
    if (signal.aborted) return;
  }

  const pool = [...unlocated, ...businessesInBBoxFromAllRanks(bbox)];
  pool.sort((a, b) => {
    const aUsable = isUsableCoordinate(parsed(a).lat, parsed(a).lng);
    const bUsable = isUsableCoordinate(parsed(b).lat, parsed(b).lng);
    if (aUsable !== bUsable) return aUsable ? 1 : -1;
    return (b.businessStartDate ?? "").localeCompare(a.businessStartDate ?? "");
  });

  const groups = new Map<string, AddressGroup>();
  for (const business of pool) {
    if (signal.aborted) return;
    if (business.coordinateSource) continue;
    const key = addressCacheKey(business);
    if (!key) continue;
    const own = parsed(business);
    const existing = groups.get(key);
    if (!existing) {
      if (groups.size >= COORDINATE_REFINE_LIMIT) continue;
      groups.set(key, {
        streetAddress: business.streetAddress ?? "",
        city: business.city,
        zipCode: business.zipCode,
        latitude: own.lat,
        longitude: own.lng,
        businesses: [business],
      });
      continue;
    }
    existing.businesses.push(business);
    if (
      !isUsableCoordinate(existing.latitude, existing.longitude) &&
      isUsableCoordinate(own.lat, own.lng)
    ) {
      existing.latitude = own.lat;
      existing.longitude = own.lng;
    }
  }

  const keys = Array.from(groups.keys());
  for (let offset = 0; offset < keys.length; offset += CAMS_BATCH_SIZE) {
    if (signal.aborted) return;
    const slice = keys.slice(offset, offset + CAMS_BATCH_SIZE);
    let payload: { results?: PlacementResponse[] };
    try {
      const response = await fetch("/api/coordinates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: slice.map((key) => {
            const group = groups.get(key)!;
            return {
              streetAddress: group.streetAddress,
              city: group.city,
              zipCode: group.zipCode,
              latitude: group.latitude,
              longitude: group.longitude,
            };
          }),
        }),
        signal,
      });
      if (!response.ok) continue;
      payload = (await response.json()) as { results?: PlacementResponse[] };
    } catch {
      if (signal.aborted) return;
      continue;
    }

    let changed = false;
    for (const placement of payload.results ?? []) {
      const group = groups.get(placement.key);
      if (!group) continue;
      for (const business of group.businesses) {
        const next = applyPlacement(business, placement);
        if (!next) continue;
        storeBusiness(next, bbox);
        changed = true;
      }
    }
    if (changed && !signal.aborted) onApplied();
  }
}
