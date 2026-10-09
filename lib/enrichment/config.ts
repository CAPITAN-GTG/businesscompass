/**
 * External-service limits for phone enrichment.
 * Change TTLs here — do not scatter them through callers.
 *
 * Overpass public instance (overpass-api.de) expects low volume: cache hard,
 * one request at a time, and back off on 429. Phone numbers do not need the
 * 60s LA dataset TTL.
 */

/** Successful high-confidence matches. */
export const ENRICHMENT_MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Lookups that ran and found nothing reliable. */
export const ENRICHMENT_NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000;

/** Timeouts, 429s, and other transient failures. Short so a later click can retry. */
export const ENRICHMENT_FAILURE_TTL_MS = 10 * 60 * 1000;

/** Pause every Overpass call after a 429, per the public instance's guidance. */
export const OVERPASS_COOLDOWN_MS = 30_000;

export const OVERPASS_TIMEOUT_MS = 12_000;
export const OVERPASS_QUERY_TIMEOUT_S = 10;
export const OVERPASS_RADIUS_M = 75;
export const OVERPASS_MAX_ELEMENTS = 40;
export const ENRICHMENT_CACHE_MAX = 2_000;

/** Extra detail requests waiting on the single Overpass slot before we give up. */
export const OVERPASS_MAX_WAITING = 2;

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
