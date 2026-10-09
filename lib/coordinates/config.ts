/**
 * LA County CAMS thresholds. Adjust here, not in callers.
 *
 * Chosen from an 80-record sample of recent Los Angeles city registrations
 * (see scripts/measure-cams.mjs):
 * - PointAddress matches with score >= 90 agreed on the house number.
 * - Where Finance already had a California coordinate, the median gap was
 *   ~18m and the 90th percentile ~43m. Nothing confident landed past 100m.
 * - 150m is the guard against a wrong CAMS hit moving a usable pin.
 * - Coordinates at 0,0 are not usable; a confident CAMS point may replace them.
 */

export const CAMS_MIN_SCORE = 90;
export const CAMS_MAX_SHIFT_METERS = 150;

/** Matches accepted for a building/unit point. Street interpolation is not. */
export const CAMS_POINT_TYPES = new Set(["PointAddress", "Subaddress"]);

/** Current County geocode host (ArcGIS 12.1). Address-point role, min service score 85. */
export const CAMS_GEOCODE_URL =
  "https://geocode.gis.lacounty.gov/geocode/rest/services/CAMS_Pro_Locator_Precise/GeocodeServer/geocodeAddresses";

/** Service documents MaxBatchSize 1000. We stay well under that per request. */
export const CAMS_BATCH_SIZE = 100;
export const CAMS_TIMEOUT_MS = 20_000;

export const COORDINATE_MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COORDINATE_MISS_TTL_MS = 24 * 60 * 60 * 1000;
export const COORDINATE_FAILURE_TTL_MS = 10 * 60 * 1000;
export const COORDINATE_CACHE_MAX = 20_000;

/** Newest Finance rows with latitude 0 that one Find may try to place. */
export const UNLOCATED_FETCH_LIMIT = 250;

/** Unique addresses resolved in the background after pins are already drawn. */
export const COORDINATE_REFINE_LIMIT = 800;
