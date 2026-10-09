import { isInCalifornia } from "../geo.ts";
import {
  compareStreetNames,
  distanceMeters,
  normalizeZip,
  parseStreetAddress,
} from "../enrichment/normalize.ts";
import { CAMS_MAX_SHIFT_METERS, CAMS_MIN_SCORE, CAMS_POINT_TYPES } from "./config.ts";

export type CoordinateSource = "la_county_cams" | "la_office_finance";
export type CoordinateConfidence = "high" | "original";

export type CamsRejectReason =
  | "unavailable"
  | "unmatched"
  | "low_score"
  | "not_point"
  | "house_mismatch"
  | "street_mismatch"
  | "zip_mismatch"
  | "outside_california"
  | "too_far";

export interface AddressParts {
  streetAddress: string | null;
  city: string | null;
  zipCode: string | null;
}

export interface CoordinatePair {
  latitude: number | null;
  longitude: number | null;
}

/** One CAMS candidate, already in WGS84. */
export interface CamsCandidate {
  status: string;
  score: number;
  addrType: string;
  matchAddress: string;
  latitude: number;
  longitude: number;
}

export interface Placement {
  latitude: number | null;
  longitude: number | null;
  coordinateSource: CoordinateSource;
  coordinateConfidence: CoordinateConfidence;
  usable: boolean;
  rejection: CamsRejectReason | null;
}

export function isUsableCoordinate(
  latitude: number | null,
  longitude: number | null,
): boolean {
  if (latitude == null || longitude == null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return isInCalifornia(latitude, longitude);
}

function originalPlacement(original: CoordinatePair): Placement {
  return {
    latitude: original.latitude,
    longitude: original.longitude,
    coordinateSource: "la_office_finance",
    coordinateConfidence: "original",
    usable: isUsableCoordinate(original.latitude, original.longitude),
    rejection: null,
  };
}

function zipInMatch(matchAddress: string): string | null {
  const hits = matchAddress.match(/\b(\d{5})(?:-\d{4})?\b/g);
  if (!hits || hits.length === 0) return null;
  return hits[hits.length - 1].slice(0, 5);
}

function rejectCams(original: CoordinatePair, reason: CamsRejectReason): Placement {
  return { ...originalPlacement(original), rejection: reason };
}

/**
 * Accept a CAMS address point only when the house, street, and ZIP agree
 * and — if Finance already has a California coordinate — the point has not
 * jumped farther than CAMS_MAX_SHIFT_METERS. Otherwise keep Finance.
 */
export function decidePlacement(
  original: CoordinatePair,
  address: AddressParts,
  cams: CamsCandidate | null,
): Placement {
  if (!cams) return rejectCams(original, "unavailable");
  if (cams.status.toUpperCase() !== "M") return rejectCams(original, "unmatched");
  if (!(cams.score >= CAMS_MIN_SCORE)) return rejectCams(original, "low_score");
  if (!CAMS_POINT_TYPES.has(cams.addrType)) return rejectCams(original, "not_point");
  if (!isUsableCoordinate(cams.latitude, cams.longitude)) {
    return rejectCams(original, "outside_california");
  }

  const wanted = parseStreetAddress(address.streetAddress);
  const matched = parseStreetAddress(cams.matchAddress.split(",")[0] ?? "");
  if (!wanted.house || wanted.house !== matched.house) {
    return rejectCams(original, "house_mismatch");
  }
  if (compareStreetNames(wanted.street, matched.street) === "conflict") {
    return rejectCams(original, "street_mismatch");
  }

  const wantedZip = normalizeZip(address.zipCode);
  const matchedZip = zipInMatch(cams.matchAddress);
  if (!wantedZip || !matchedZip || wantedZip !== matchedZip) {
    return rejectCams(original, "zip_mismatch");
  }

  if (
    isUsableCoordinate(original.latitude, original.longitude) &&
    distanceMeters(
      original.latitude as number,
      original.longitude as number,
      cams.latitude,
      cams.longitude,
    ) > CAMS_MAX_SHIFT_METERS
  ) {
    return rejectCams(original, "too_far");
  }

  return {
    latitude: cams.latitude,
    longitude: cams.longitude,
    coordinateSource: "la_county_cams",
    coordinateConfidence: "high",
    usable: true,
    rejection: null,
  };
}

/**
 * Businesses that share a building share one decision. The distance check
 * uses a usable Finance coordinate when any of them has one, so a 0,0
 * sibling does not pull a good pin toward null island, and a rejected CAMS
 * hit still keeps that usable coordinate for the whole building.
 */
export function decideSharedPlacement(
  originals: CoordinatePair[],
  address: AddressParts,
  cams: CamsCandidate | null,
): Placement {
  const reference =
    originals.find((item) =>
      isUsableCoordinate(item.latitude, item.longitude),
    ) ?? originals[0] ?? { latitude: null, longitude: null };
  return decidePlacement(reference, address, cams);
}
