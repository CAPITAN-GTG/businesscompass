import { isInCalifornia } from "@/lib/geo";
import type { Business, BusinessEnrichment } from "@/lib/types/business";
import {
  readEnrichmentCache,
  writeEnrichmentCache,
} from "@/lib/enrichment/cache";
import {
  ENRICHMENT_FAILURE_TTL_MS,
  ENRICHMENT_MATCH_TTL_MS,
  ENRICHMENT_NO_MATCH_TTL_MS,
  OVERPASS_COOLDOWN_MS,
  OVERPASS_MAX_WAITING,
} from "@/lib/enrichment/config";
import { decideMatch, subjectNames, type MatchSubject } from "@/lib/enrichment/match";
import { fetchNearbyOsm } from "@/lib/enrichment/overpass";

const UNAVAILABLE: BusinessEnrichment = {
  phone: null,
  phoneDisplay: null,
  website: null,
  source: null,
  confidence: "none",
  status: "unavailable",
};

const SLOT_KEY = Symbol.for("businesscompass.overpassSlot");

interface OverpassSlot {
  inflight: Map<string, Promise<BusinessEnrichment>>;
  cooldownUntil: number;
  depth: number;
  tail: Promise<void>;
}

function overpassSlot(): OverpassSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: OverpassSlot };
  if (!g[SLOT_KEY]) {
    g[SLOT_KEY] = {
      inflight: new Map(),
      cooldownUntil: 0,
      depth: 0,
      tail: Promise.resolve(),
    };
  }
  return g[SLOT_KEY];
}

/**
 * Find a public phone/website for one LA business. Never throws.
 * Cached misses and hits so detail views do not repeat Overpass calls.
 */
export async function enrichBusiness(
  business: Business,
): Promise<BusinessEnrichment> {
  const cached = readEnrichmentCache(business.id);
  if (cached) return cached;

  const slot = overpassSlot();
  const pending = slot.inflight.get(business.id);
  if (pending) return pending;

  const job = runEnrichment(business).finally(() => {
    slot.inflight.delete(business.id);
  });
  slot.inflight.set(business.id, job);
  return job;
}

async function runEnrichment(business: Business): Promise<BusinessEnrichment> {
  try {
    return await runEnrichmentInner(business);
  } catch {
    writeEnrichmentCache(business.id, UNAVAILABLE, ENRICHMENT_FAILURE_TTL_MS);
    return UNAVAILABLE;
  }
}

async function runEnrichmentInner(business: Business): Promise<BusinessEnrichment> {
  const subject = toSubject(business);
  if (!subject) {
    const miss = noMatch("none");
    writeEnrichmentCache(business.id, miss, ENRICHMENT_NO_MATCH_TTL_MS);
    return miss;
  }

  if (Date.now() < overpassSlot().cooldownUntil) {
    return UNAVAILABLE;
  }

  const fetched = await withOverpassSlot(async () => {
    if (Date.now() < overpassSlot().cooldownUntil) return "cooldown" as const;
    return fetchNearbyOsm(subject.latitude, subject.longitude);
  });
  if (fetched === "busy" || fetched === "cooldown") return UNAVAILABLE;

  if (!fetched.ok) {
    if (fetched.reason === "rate_limit") {
      overpassSlot().cooldownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
    }
    writeEnrichmentCache(business.id, UNAVAILABLE, ENRICHMENT_FAILURE_TTL_MS);
    return UNAVAILABLE;
  }

  const decision = decideMatch(subject, fetched.candidates, {
    truncated: fetched.truncated,
  });
  const result = toEnrichment(decision);
  const ttl =
    result.status === "matched"
      ? ENRICHMENT_MATCH_TTL_MS
      : ENRICHMENT_NO_MATCH_TTL_MS;
  writeEnrichmentCache(business.id, result, ttl);
  return result;
}

function toEnrichment(
  decision: ReturnType<typeof decideMatch>,
): BusinessEnrichment {
  if (
    decision.confidence === "high" &&
    (decision.phone || decision.website)
  ) {
    return {
      phone: decision.phone,
      phoneDisplay: decision.phoneDisplay,
      website: decision.website,
      source: "openstreetmap",
      confidence: "high",
      status: "matched",
    };
  }
  return noMatch(decision.confidence === "high" ? "none" : decision.confidence);
}

function noMatch(confidence: BusinessEnrichment["confidence"]): BusinessEnrichment {
  return {
    phone: null,
    phoneDisplay: null,
    website: null,
    source: null,
    confidence,
    status: "no_match",
  };
}

function toSubject(business: Business): MatchSubject | null {
  const latitude = business.latitude ? Number.parseFloat(business.latitude) : NaN;
  const longitude = business.longitude ? Number.parseFloat(business.longitude) : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!isInCalifornia(latitude, longitude)) return null;

  return {
    names: subjectNames(business.businessName, business.dbaName),
    streetAddress: business.streetAddress,
    zipCode: business.zipCode,
    latitude,
    longitude,
  };
}

/** One Overpass call at a time. Extra detail views wait; a long queue fails open. */
function withOverpassSlot<T>(fn: () => Promise<T>): Promise<T | "busy"> {
  const slot = overpassSlot();
  if (slot.depth >= 1 + OVERPASS_MAX_WAITING) {
    return Promise.resolve("busy");
  }
  slot.depth += 1;
  const run = slot.tail.then(async () => {
    try {
      return await fn();
    } finally {
      slot.depth = Math.max(0, slot.depth - 1);
    }
  });
  slot.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
