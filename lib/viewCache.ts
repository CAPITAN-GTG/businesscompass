import type { AgeColorBand } from "@/lib/ageColor";
import { ageColorBandFromStartDate } from "@/lib/ageColor";
import { mapBBoxKey, type MapBBox } from "@/lib/geo";
import type { Business } from "@/lib/types/business";
import { VIEW_FETCH_MAX_PER_RANK } from "@/lib/viewLimits";

/**
 * Session-only cache (module scope). Cleared on “Keep looking” or full page reload.
 * One store per rank — UI shows a single rank at a time.
 */

export type ViewFilterKey = AgeColorBand;

export function viewFilterKey(filter: AgeColorBand): ViewFilterKey {
  return filter;
}

export function businessInBBox(b: Business, bbox: MapBBox): boolean {
  const lat = b.latitude ? Number.parseFloat(b.latitude) : NaN;
  const lng = b.longitude ? Number.parseFloat(b.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= bbox.south &&
    lat <= bbox.north &&
    lng >= bbox.west &&
    lng <= bbox.east
  );
}

interface FilterStore {
  byId: Map<string, Business>;
  /** Fully loaded committed areas for this rank (`mapBBoxKey`). */
  loadedAreas: Set<string>;
  /** Areas that matched too many rows to load — value is API match count. */
  tooDenseCounts: Map<string, number>;
}

const stores = new Map<ViewFilterKey, FilterStore>();

function getStore(key: ViewFilterKey): FilterStore {
  let store = stores.get(key);
  if (!store) {
    store = {
      byId: new Map(),
      loadedAreas: new Set(),
      tooDenseCounts: new Map(),
    };
    stores.set(key, store);
  }
  return store;
}

export function areaCacheKey(bbox: MapBBox): string {
  return mapBBoxKey(bbox);
}

/** Only stores rows whose start date classifies into this rank. */
export function mergeBusinessesIntoCache(
  key: ViewFilterKey,
  businesses: Business[],
): number {
  const store = getStore(key);
  let added = 0;
  for (const b of businesses) {
    if (!b.id) continue;
    if (ageColorBandFromStartDate(b.businessStartDate) !== key) continue;
    store.byId.set(b.id, b);
    added += 1;
  }
  return added;
}

export function markAreaLoaded(key: ViewFilterKey, bbox: MapBBox): void {
  const store = getStore(key);
  const id = areaCacheKey(bbox);
  store.loadedAreas.add(id);
  store.tooDenseCounts.delete(id);
}

export function markAreaTooDense(
  key: ViewFilterKey,
  bbox: MapBBox,
  matchedCount: number,
): void {
  const store = getStore(key);
  const id = areaCacheKey(bbox);
  store.tooDenseCounts.set(id, matchedCount);
  store.loadedAreas.add(id);
}

export function isAreaLoaded(key: ViewFilterKey, bbox: MapBBox): boolean {
  return getStore(key).loadedAreas.has(areaCacheKey(bbox));
}

/** Match count when this rank was too dense to load; otherwise null. */
export function areaTooDenseCount(
  key: ViewFilterKey,
  bbox: MapBBox,
): number | null {
  const n = getStore(key).tooDenseCounts.get(areaCacheKey(bbox));
  return n != null && Number.isFinite(n) ? n : null;
}

export function businessesInBBoxFromCache(
  key: ViewFilterKey,
  bbox: MapBBox,
): Business[] {
  const store = getStore(key);
  const out: Business[] = [];
  for (const b of store.byId.values()) {
    if (!businessInBBox(b, bbox)) continue;
    // Defense in depth — never show a row that belongs to another rank.
    if (ageColorBandFromStartDate(b.businessStartDate) !== key) continue;
    out.push(b);
  }
  out.sort((a, b) => {
    const da = a.businessStartDate ?? "";
    const db = b.businessStartDate ?? "";
    return db.localeCompare(da);
  });
  return out;
}

/** All ranks combined for the locked area (deduped by id). */
const MAX_LOADED_AREAS_PER_RANK = 4;

/**
 * Drop a rank's session cache before loading yet another area.
 * A single Find can be up to VIEW_FETCH_MAX_PER_RANK rows; stacking those
 * across many pans would grow the module Map without a ceiling.
 * The area about to load is fetched again by the caller.
 */
export function releaseRankCacheIfFull(key: ViewFilterKey, bbox: MapBBox): void {
  const store = stores.get(key);
  if (!store) return;
  if (store.loadedAreas.has(areaCacheKey(bbox))) return;
  if (
    store.loadedAreas.size >= MAX_LOADED_AREAS_PER_RANK ||
    store.byId.size >= VIEW_FETCH_MAX_PER_RANK
  ) {
    store.byId.clear();
    store.loadedAreas.clear();
    store.tooDenseCounts.clear();
  }
}

/** Replace a cached row in place. Returns false when the id is not loaded. */
export function replaceCachedBusiness(next: Business): boolean {
  if (!next.id) return false;
  let found = false;
  for (const store of stores.values()) {
    if (!store.byId.has(next.id)) continue;
    store.byId.set(next.id, next);
    found = true;
  }
  return found;
}

export function businessesInBBoxFromAllRanks(bbox: MapBBox): Business[] {
  const byId = new Map<string, Business>();
  for (const key of stores.keys()) {
    for (const b of businessesInBBoxFromCache(key, bbox)) {
      byId.set(b.id, b);
    }
  }
  const out = Array.from(byId.values());
  out.sort((a, b) => {
    const da = a.businessStartDate ?? "";
    const db = b.businessStartDate ?? "";
    return db.localeCompare(da);
  });
  return out;
}

/** Wipe session data so the next search starts clean. */
export function clearSessionCache(): void {
  stores.clear();
}
