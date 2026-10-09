import type { EnrichmentConfidence } from "../types/business";
import {
  compareStreetNames,
  distanceMeters,
  nameSimilarity,
  normalizeBusinessName,
  normalizePhone,
  normalizeUnit,
  normalizeWebsite,
  normalizeZip,
  parseStreetAddress,
} from "./normalize.ts";

/**
 * Match an LA registration to nearby OSM objects.
 *
 * A phone or website is returned only at confidence "high". False contact
 * data is worse than a blank. Thresholds:
 *
 * 1. Exact house number + street, units agree (both missing or equal),
 *    name >= 0.9, distance <= 80m, ZIP does not disagree.
 * 2. Same as (1), but OSM has a unit the LA record does not, and name >= 0.95.
 *    (The named business is identified; the unit is extra precision.)
 * 2b. House numbers match and the street is a near miss (spelling), units agree,
 *    name >= 0.95, distance <= 50m.
 * 3. OSM has no street address, names match at >= 0.98, distance <= 20m,
 *    and no other object in the radius has name >= 0.9. Disabled when the
 *    Overpass result was truncated, because a same-name neighbor may be missing.
 *
 * Rejected even when the name looks right:
 * - different house number
 * - clearly different street
 * - different unit on both sides
 * - different ZIP
 * - LA has a unit and OSM does not (another tenant in the building may own the phone)
 * - two high matches that disagree on phone or website
 */

export interface MatchSubject {
  names: string[];
  streetAddress: string | null;
  zipCode: string | null;
  latitude: number;
  longitude: number;
}

export interface OsmCandidate {
  id: string;
  names: string[];
  phones: string[];
  websites: string[];
  houseNumber: string | null;
  street: string | null;
  unit: string | null;
  postcode: string | null;
  lat: number;
  lng: number;
}

export interface MatchDecision {
  confidence: EnrichmentConfidence;
  phone: string | null;
  phoneDisplay: string | null;
  website: string | null;
  osmId: string | null;
}

interface Scored {
  id: string;
  nameScore: number;
  distanceM: number;
  confidence: EnrichmentConfidence;
  provisionalNameOnly: boolean;
  phone: string | null;
  phoneDisplay: string | null;
  website: string | null;
}

export function bestNameScore(subjectNames: string[], osmNames: string[]): number {
  let best = 0;
  for (const subject of subjectNames) {
    if (!normalizeBusinessName(subject)) continue;
    for (const osm of osmNames) {
      const score = nameSimilarity(subject, osm);
      if (score > best) best = score;
    }
  }
  return best;
}

export function subjectNames(businessName: string | null, dbaName: string | null): string[] {
  const names: string[] = [];
  if (businessName?.trim()) names.push(businessName);
  if (dbaName) {
    for (const part of dbaName.split("|")) {
      if (part.trim()) names.push(part);
    }
  }
  return names;
}

export function decideMatch(
  subject: MatchSubject,
  candidates: OsmCandidate[],
  options?: { truncated?: boolean },
): MatchDecision {
  const scored = candidates.map((candidate) => scoreCandidate(subject, candidate));
  const highs = scored.filter((row) => row.confidence === "high");

  if (highs.length === 1) return decisionFrom(highs[0]);
  if (highs.length > 1) return decisionFromShared(highs);

  if (!options?.truncated) {
    const promoted = promoteUniqueNameOnly(scored);
    if (promoted) return decisionFrom(promoted);
  }

  const best = scored.reduce<Scored | null>((top, row) => {
    if (!top || rank(row) > rank(top)) return row;
    return top;
  }, null);

  return {
    confidence: best?.confidence ?? "none",
    phone: null,
    phoneDisplay: null,
    website: null,
    osmId: null,
  };
}

function rank(row: Scored): number {
  const confidence = { high: 3, medium: 2, low: 1, none: 0 }[row.confidence];
  return confidence * 10 + row.nameScore;
}

function decisionFrom(row: Scored): MatchDecision {
  if (!row.phone && !row.website) {
    return {
      confidence: "none",
      phone: null,
      phoneDisplay: null,
      website: null,
      osmId: null,
    };
  }
  return {
    confidence: "high",
    phone: row.phone,
    phoneDisplay: row.phoneDisplay,
    website: row.website,
    osmId: row.id,
  };
}

/** Node + way duplicates often share one phone. Disagreeing phones are ambiguous. */
function decisionFromShared(highs: Scored[]): MatchDecision {
  const phones = uniquePresent(highs.map((row) => row.phone));
  const websites = uniquePresent(highs.map((row) => row.website));
  if (phones.length > 1 || websites.length > 1) {
    return {
      confidence: "none",
      phone: null,
      phoneDisplay: null,
      website: null,
      osmId: null,
    };
  }
  const phone = phones[0] ?? null;
  const website = websites[0] ?? null;
  if (!phone && !website) {
    return {
      confidence: "none",
      phone: null,
      phoneDisplay: null,
      website: null,
      osmId: null,
    };
  }
  const display = highs.find((row) => row.phone === phone)?.phoneDisplay ?? null;
  return {
    confidence: "high",
    phone,
    phoneDisplay: phone ? display : null,
    website,
    osmId: highs[0].id,
  };
}

function uniquePresent(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function promoteUniqueNameOnly(scored: Scored[]): Scored | null {
  const nameOnly = scored.filter((row) => row.provisionalNameOnly);
  if (nameOnly.length !== 1) return null;
  const winner = nameOnly[0];
  const contested = scored.filter(
    (row) => row.nameScore >= 0.9 && row.distanceM <= 80,
  );
  if (contested.length !== 1 || contested[0].id !== winner.id) return null;
  return { ...winner, confidence: "high", provisionalNameOnly: false };
}

function scoreCandidate(subject: MatchSubject, candidate: OsmCandidate): Scored {
  const distanceM = distanceMeters(
    subject.latitude,
    subject.longitude,
    candidate.lat,
    candidate.lng,
  );
  const nameScore = bestNameScore(subject.names, candidate.names);
  const phone = firstPhone(candidate.phones);
  const website = firstWebsite(candidate.websites);
  const base = {
    id: candidate.id,
    nameScore,
    distanceM,
    phone: phone?.e164 ?? null,
    phoneDisplay: phone?.display ?? null,
    website,
    provisionalNameOnly: false,
  };

  const empty: Scored = { ...base, confidence: "none" };
  if (distanceM > 100) return empty;

  const address = compareAddress(subject, candidate);
  if (address.zipConflict || address.relation === "conflict" || address.unit === "conflict") {
    return empty;
  }

  const unitsAgree = address.unit === "ok";
  const osmUnitOnly = address.unit === "osm-only";
  const laUnitOnly = address.unit === "la-only";

  if (
    address.relation === "exact" &&
    unitsAgree &&
    nameScore >= 0.9 &&
    distanceM <= 80
  ) {
    return { ...base, confidence: "high" };
  }

  if (
    address.relation === "exact" &&
    osmUnitOnly &&
    nameScore >= 0.95 &&
    distanceM <= 80
  ) {
    return { ...base, confidence: "high" };
  }

  if (
    address.relation === "close" &&
    unitsAgree &&
    nameScore >= 0.95 &&
    distanceM <= 50
  ) {
    return { ...base, confidence: "high" };
  }

  const nameOnly =
    address.relation === "missing" &&
    (address.unit === "ok" || address.unit === "absent") &&
    nameScore >= 0.98 &&
    distanceM <= 20 &&
    Boolean(phone || website);

  if (
    address.relation === "exact" &&
    (unitsAgree || laUnitOnly || osmUnitOnly) &&
    nameScore >= 0.8 &&
    distanceM <= 80
  ) {
    return { ...base, confidence: "medium", provisionalNameOnly: nameOnly };
  }

  if (address.relation === "missing" && nameScore >= 0.95 && distanceM <= 35) {
    return { ...base, confidence: "medium", provisionalNameOnly: nameOnly };
  }

  if (nameScore >= 0.85 && distanceM <= 40) {
    return { ...base, confidence: "low", provisionalNameOnly: nameOnly };
  }

  if (nameOnly) {
    return { ...base, confidence: "low", provisionalNameOnly: true };
  }

  return empty;
}

function firstPhone(raws: string[]) {
  for (const raw of raws) {
    const phone = normalizePhone(raw);
    if (phone) return phone;
  }
  return null;
}

function firstWebsite(raws: string[]) {
  for (const raw of raws) {
    const website = normalizeWebsite(raw);
    if (website) return website;
  }
  return null;
}

type AddressRelation = "exact" | "close" | "missing" | "conflict";
type UnitRelation = "ok" | "osm-only" | "la-only" | "conflict" | "absent";

function compareAddress(
  subject: MatchSubject,
  candidate: OsmCandidate,
): { relation: AddressRelation; unit: UnitRelation; zipConflict: boolean } {
  const la = parseStreetAddress(subject.streetAddress);
  const osmStreetRaw = [candidate.houseNumber, candidate.street].filter(Boolean).join(" ");
  const osm = candidate.houseNumber
    ? {
        house: candidate.houseNumber.replace(/^0+(?=\d)/, ""),
        street: parseStreetAddress(candidate.street ?? "").street,
        unit: normalizeUnit(candidate.unit),
      }
    : parseStreetAddress(osmStreetRaw || null);

  const laZip = normalizeZip(subject.zipCode);
  const osmZip = normalizeZip(candidate.postcode);
  const zipConflict = Boolean(laZip && osmZip && laZip !== osmZip);

  const laUnit = la.unit;
  const osmUnit = normalizeUnit(candidate.unit) ?? osm.unit;
  let unit: UnitRelation = "absent";
  if (laUnit && osmUnit) unit = laUnit === osmUnit ? "ok" : "conflict";
  else if (laUnit && !osmUnit) unit = "la-only";
  else if (!laUnit && osmUnit) unit = "osm-only";
  else unit = "ok";

  if (la.house && osm.house && la.house !== osm.house) {
    return { relation: "conflict", unit, zipConflict };
  }

  const laHas = Boolean(la.house && la.street);
  const osmHas = Boolean(osm.house && osm.street);
  if (!laHas || !osmHas) {
    return { relation: "missing", unit, zipConflict };
  }

  const street = compareStreetNames(la.street, osm.street);
  if (street === "exact" || street === "close") {
    return { relation: street, unit, zipConflict };
  }
  return { relation: "conflict", unit, zipConflict };
}
