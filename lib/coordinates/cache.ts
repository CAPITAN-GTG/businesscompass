import { COORDINATE_CACHE_MAX } from "./config.ts";
import type { Placement } from "./decide.ts";

interface CacheEntry {
  expiresAt: number;
  value: Placement;
}

const CACHE_KEY = Symbol.for("businesscompass.coordinateCache");

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [CACHE_KEY]?: Map<string, CacheEntry>;
  };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY];
}

export function readCoordinateCache(
  key: string,
  now = Date.now(),
): Placement | null {
  const cache = cacheMap();
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

export function writeCoordinateCache(
  key: string,
  value: Placement,
  ttlMs: number,
  now = Date.now(),
): void {
  const cache = cacheMap();
  if (!key || ttlMs <= 0) return;
  cache.delete(key);
  cache.set(key, { expiresAt: now + ttlMs, value });
  while (cache.size > COORDINATE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearCoordinateCache(): void {
  cacheMap().clear();
}
