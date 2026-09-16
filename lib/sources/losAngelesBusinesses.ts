import {
  CA_EAST,
  CA_NORTH,
  CA_SOUTH,
  CA_WEST,
  intersectMapBBoxWithCalifornia,
  isValidMapBBox,
} from "@/lib/geo";
import { VIEW_FETCH_MAX_PER_RANK } from "@/lib/viewLimits";
import type {
  Business,
  BusinessListResult,
  BusinessQuery,
  BusinessSort,
} from "@/lib/types/business";
import type { BusinessSource } from "@/lib/sources/types";

/**
 * City of Los Angeles Open Data — Office of Finance
 * Dataset: Listing of Active Businesses
 * API: https://data.lacity.org/resource/6rrh-rzua.json
 */

const API_BASE = "https://data.lacity.org/resource/6rrh-rzua.json";
const DATASET_URL =
  "https://data.lacity.org/Administration-Finance/Listing-of-Active-Businesses/6rrh-rzua";

const SOURCE_NAME = "City of Los Angeles Office of Finance";
const SOURCE_TYPE = "Los Angeles Business Registration";

const PAGE_SIZE_DEFAULT = 25;
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 60_000;

/** Lean columns for map/list browsing. */
const LIST_SELECT = [
  "location_account",
  "business_name",
  "street_address",
  "city",
  "zip_code",
  "primary_naics_description",
  "location_start_date",
  "location_1",
].join(",");

interface LaRawRecord {
  location_account?: string;
  business_name?: string;
  dba_name?: string;
  street_address?: string;
  city?: string;
  zip_code?: string;
  location_description?: string;
  mailing_address?: string;
  mailing_city?: string;
  mailing_zip_code?: string;
  naics?: string;
  primary_naics_description?: string;
  council_district?: string | number;
  location_start_date?: string;
  location_end_date?: string;
  location_1?: {
    latitude?: string;
    longitude?: string;
    human_address?: string;
  };
}

interface CacheEntry {
  expiresAt: number;
  payload: unknown;
}

const queryCache = new Map<string, CacheEntry>();

function nullIfEmpty(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function escapeSoqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sanitizeLikeTerm(value: string): string {
  return value.replace(/[%_]/g, "").trim();
}

function toOrderClause(sort: BusinessSort): string {
  switch (sort) {
    case "start_date_asc":
      return "location_start_date ASC";
    case "name_asc":
      return "business_name ASC";
    case "name_desc":
      return "business_name DESC";
    case "start_date_desc":
    default:
      return "location_start_date DESC";
  }
}

function geoBoxClause(query: BusinessQuery): string | null {
  // Prefer the live map viewport; always clamp to California.
  if (query.bbox && isValidMapBBox(query.bbox)) {
    const box = intersectMapBBoxWithCalifornia(query.bbox);
    if (!box) return null;
    return `within_box(location_1, ${box.north}, ${box.west}, ${box.south}, ${box.east})`;
  }
  return `within_box(location_1, ${CA_NORTH}, ${CA_WEST}, ${CA_SOUTH}, ${CA_EAST})`;
}

function buildWhere(query: BusinessQuery): string | null {
  const clauses: string[] = [];

  // Map finder only needs geocoded points inside the active box.
  clauses.push("location_1 IS NOT NULL");
  const geo = geoBoxClause(query);
  if (!geo) {
    // Empty intersection with CA — force zero rows.
    clauses.push("1 = 0");
  } else {
    clauses.push(geo);
  }

  if (
    query.sort === "start_date_desc" ||
    query.sort === "start_date_asc"
  ) {
    clauses.push("location_start_date IS NOT NULL");
  }

  if (query.businessName) {
    const term = sanitizeLikeTerm(query.businessName);
    if (term) {
      clauses.push(
        `upper(business_name) like upper('%${escapeSoqlString(term)}%')`,
      );
    }
  }

  if (query.dbaName) {
    const term = sanitizeLikeTerm(query.dbaName);
    if (term) {
      clauses.push(
        `upper(dba_name) like upper('%${escapeSoqlString(term)}%')`,
      );
    }
  }

  if (query.city) {
    const term = sanitizeLikeTerm(query.city);
    if (term) {
      clauses.push(`upper(city) like upper('%${escapeSoqlString(term)}%')`);
    }
  }

  if (query.zipCode) {
    const zip = query.zipCode.replace(/[^0-9-]/g, "").trim();
    if (zip) {
      clauses.push(`starts_with(zip_code, '${escapeSoqlString(zip)}')`);
    }
  }

  if (query.naicsOrIndustry) {
    const term = sanitizeLikeTerm(query.naicsOrIndustry);
    if (term) {
      const escaped = escapeSoqlString(term);
      clauses.push(
        `(naics like '%${escaped}%' OR upper(primary_naics_description) like upper('%${escaped}%'))`,
      );
    }
  }

  if (query.startDateFrom) {
    clauses.push(
      `location_start_date >= '${escapeSoqlString(query.startDateFrom)}T00:00:00.000'`,
    );
  }

  if (query.startDateTo) {
    clauses.push(
      `location_start_date <= '${escapeSoqlString(query.startDateTo)}T23:59:59.000'`,
    );
  }

  return clauses.join(" AND ");
}

function normalize(raw: LaRawRecord): Business {
  return {
    id: nullIfEmpty(raw.location_account) ?? "",
    businessName: nullIfEmpty(raw.business_name),
    dbaName: nullIfEmpty(raw.dba_name),
    streetAddress: nullIfEmpty(raw.street_address),
    city: nullIfEmpty(raw.city),
    state: "CA",
    zipCode: nullIfEmpty(raw.zip_code),
    mailingAddress: nullIfEmpty(raw.mailing_address),
    mailingCity: nullIfEmpty(raw.mailing_city),
    mailingZipCode: nullIfEmpty(raw.mailing_zip_code),
    locationDescription: nullIfEmpty(raw.location_description),
    naicsCode: nullIfEmpty(raw.naics),
    industry: nullIfEmpty(raw.primary_naics_description),
    councilDistrict:
      raw.council_district === null || raw.council_district === undefined
        ? null
        : nullIfEmpty(String(raw.council_district)),
    businessStartDate: nullIfEmpty(raw.location_start_date),
    businessEndDate: nullIfEmpty(raw.location_end_date),
    latitude: nullIfEmpty(raw.location_1?.latitude),
    longitude: nullIfEmpty(raw.location_1?.longitude),
    source: SOURCE_NAME,
    sourceType: SOURCE_TYPE,
  };
}

async function sodFetch<T>(url: string): Promise<T> {
  const cached = queryCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload as T;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      throw new Error(`LA Open Data API returned ${res.status}`);
    }

    const data = (await res.json()) as T;
    queryCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, payload: data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function buildListUrl(query: BusinessQuery): string {
  const pageSize = query.pageSize || PAGE_SIZE_DEFAULT;
  const page = Math.max(1, query.page || 1);
  const offset = (page - 1) * pageSize;

  const params = new URLSearchParams();
  params.set("$select", LIST_SELECT);
  params.set("$limit", String(pageSize));
  params.set("$offset", String(offset));
  params.set("$order", toOrderClause(query.sort));

  const where = buildWhere(query);
  if (where) params.set("$where", where);

  return `${API_BASE}?${params.toString()}`;
}

function buildCountUrl(query: BusinessQuery): string {
  const params = new URLSearchParams();
  params.set("$select", "count(*) as total");
  const where = buildWhere(query);
  if (where) params.set("$where", where);
  return `${API_BASE}?${params.toString()}`;
}

export class LosAngelesDataUnavailableError extends Error {
  constructor(message = "Los Angeles business data is temporarily unavailable.") {
    super(message);
    this.name = "LosAngelesDataUnavailableError";
  }
}

/** Viewport matched more rows than we safely load in one shot. */
export class AreaTooDenseError extends Error {
  readonly totalCount: number;
  readonly maxAllowed: number;

  constructor(totalCount: number, maxAllowed: number = VIEW_FETCH_MAX_PER_RANK) {
    super(
      `This map area has ${totalCount.toLocaleString()} matching businesses (limit ${maxAllowed.toLocaleString()}). Zoom in or filter by rank.`,
    );
    this.name = "AreaTooDenseError";
    this.totalCount = totalCount;
    this.maxAllowed = maxAllowed;
  }
}

export async function withLaErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LosAngelesDataUnavailableError) throw err;
    if (err instanceof AreaTooDenseError) throw err;
    throw new LosAngelesDataUnavailableError(
      err instanceof Error ? err.message : undefined,
    );
  }
}

export const losAngelesBusinessSource: BusinessSource = {
  meta: {
    id: "la-office-of-finance",
    name: SOURCE_NAME,
    description:
      "Listing of Active Businesses registered with the Los Angeles Office of Finance. Location start date is the start of first registered business activity at that location — not legal entity formation.",
    officialUrl: DATASET_URL,
    dataPortalUrl: API_BASE,
  },

  async list(query: BusinessQuery): Promise<BusinessListResult> {
    const pageSize = query.pageSize || PAGE_SIZE_DEFAULT;
    const page = Math.max(1, query.page || 1);

    // Viewport: count on first page only (density + progress target).
    const wantCount =
      (Boolean(query.bbox) && page === 1) ||
      (!query.bbox && pageSize <= 200);

    const [rows, countRows] = await Promise.all([
      sodFetch<LaRawRecord[]>(buildListUrl({ ...query, page, pageSize })),
      wantCount
        ? sodFetch<Array<{ total: string }>>(buildCountUrl(query)).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

    const totalCount =
      countRows && countRows[0]?.total != null
        ? Number(countRows[0].total)
        : null;

    if (
      query.bbox &&
      page === 1 &&
      totalCount != null &&
      totalCount > VIEW_FETCH_MAX_PER_RANK
    ) {
      throw new AreaTooDenseError(totalCount, VIEW_FETCH_MAX_PER_RANK);
    }

    const businesses = rows.map(normalize).filter((b) => b.id !== "");

    const hasMore =
      totalCount != null
        ? page * pageSize < totalCount
        : businesses.length === pageSize;

    return {
      businesses,
      page,
      pageSize,
      totalCount: Number.isFinite(totalCount as number) ? totalCount : null,
      hasMore,
    };
  },

  async getById(id: string): Promise<Business | null> {
    const safeId = id.trim();
    if (!safeId) return null;

    const params = new URLSearchParams();
    params.set("$limit", "1");
    params.set(
      "$where",
      `location_account = '${escapeSoqlString(safeId)}'`,
    );

    const url = `${API_BASE}?${params.toString()}`;
    const rows = await sodFetch<LaRawRecord[]>(url);
    if (!rows.length) return null;
    const business = normalize(rows[0]);
    return business.id ? business : null;
  },
};
