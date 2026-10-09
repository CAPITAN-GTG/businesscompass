import type { BusinessEnrichment } from "../types/business";
import { ENRICHMENT_CACHE_MAX } from "./config.ts";

interface CacheEntry {
  expiresAt: number;
  value: BusinessEnrichment;
}

const CACHE_KEY = Symbol.for("businesscompass.enrichmentCache");

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [CACHE_KEY]?: Map<string, CacheEntry>;
  };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY];
}

export function readEnrichmentCache(
  id: string,
  now = Date.now(),
): BusinessEnrichment | null {
  const cache = cacheMap();
  const hit = cache.get(id);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(id);
    return null;
  }
  // Refresh recency so a full cache drops stale ids first.
  cache.delete(id);
  cache.set(id, hit);
  return hit.value;
}

export function writeEnrichmentCache(
  id: string,
  value: BusinessEnrichment,
  ttlMs: number,
  now = Date.now(),
): void {
  const cache = cacheMap();
  if (!id || ttlMs <= 0) return;
  cache.delete(id);
  cache.set(id, { expiresAt: now + ttlMs, value });
  while (cache.size > ENRICHMENT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearEnrichmentCache(): void {
  cacheMap().clear();
}
