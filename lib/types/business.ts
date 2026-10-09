/**
 * Normalized internal business record.
 * Source adapters map their datasets into this shape.
 *
 * businessStartDate is the source's location/activity start date —
 * NOT a California Secretary of State formation date.
 */
export interface Business {
  id: string;
  businessName: string | null;
  dbaName: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingZipCode: string | null;
  locationDescription: string | null;
  naicsCode: string | null;
  industry: string | null;
  councilDistrict: string | null;
  /** Location / first-activity start date from the source (not legal formation). */
  businessStartDate: string | null;
  businessEndDate: string | null;
  latitude: string | null;
  longitude: string | null;
  /** Which coordinate is currently stored. Omitted until a placement decision is made. */
  coordinateSource?: "la_county_cams" | "la_office_finance";
  /** "high" only when a CAMS address point was accepted. "original" keeps the Finance coordinate. */
  coordinateConfidence?: "high" | "original";
  source: string;
  sourceType: string;
}

export type BusinessSort =
  | "start_date_desc"
  | "start_date_asc"
  | "name_asc"
  | "name_desc";

/** Optional map viewport; when set, results are limited to this box (clamped to CA). */
export interface BusinessBBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface BusinessQuery {
  page: number;
  pageSize: number;
  sort: BusinessSort;
  businessName?: string;
  dbaName?: string;
  city?: string;
  zipCode?: string;
  /** Matches NAICS code and/or industry description. */
  naicsOrIndustry?: string;
  startDateFrom?: string; // YYYY-MM-DD
  startDateTo?: string; // YYYY-MM-DD
  /** When set, recent registrations with no usable coordinate (0,0) instead of a map box. */
  unlocated?: boolean;
  /** When set, SoQL within_box uses this viewport instead of all of California. */
  bbox?: BusinessBBox;
}

export interface BusinessListResult {
  businesses: Business[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean;
}

export interface BusinessSourceMeta {
  id: string;
  name: string;
  description: string;
  officialUrl: string;
  dataPortalUrl: string;
}

/**
 * Public contact data found for one LA business.
 * phone / website are set only when confidence is "high".
 * status distinguishes a real miss from a failed lookup.
 */
export type EnrichmentConfidence = "high" | "medium" | "low" | "none";

export type EnrichmentStatus = "matched" | "no_match" | "unavailable";

export interface BusinessEnrichment {
  /** E.164, for tel: links. Null unless confidence is high. */
  phone: string | null;
  /** Display form of phone. Null unless confidence is high. */
  phoneDisplay: string | null;
  /** http(s) URL. Null unless confidence is high. */
  website: string | null;
  source: "openstreetmap" | null;
  confidence: EnrichmentConfidence;
  status: EnrichmentStatus;
}
