import {
  normalizeZip,
  parseStreetAddress,
} from "../enrichment/normalize.ts";

/**
 * Building-level key. Suites are omitted so businesses at the same street
 * address share one geocode. The displayed address is not changed.
 */
export function addressCacheKey(input: {
  streetAddress: string | null;
  city: string | null;
  zipCode: string | null;
}): string | null {
  const parsed = parseStreetAddress(input.streetAddress);
  const zip = normalizeZip(input.zipCode);
  const city = (input.city || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!parsed.house || !parsed.street || !zip) return null;
  return `${parsed.house}|${parsed.street}|${zip}|${city}`;
}

/** Street line sent to CAMS: original wording, suite removed, spacing collapsed. */
export function buildingAddressLine(streetAddress: string | null): string | null {
  if (!streetAddress) return null;
  const parsed = parseStreetAddress(streetAddress);
  if (!parsed.house || !parsed.street) return null;
  let text = streetAddress.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  text = text
    .replace(
      /\b(?:SUITES?|STE|APTS?|APARTMENTS?|UNITS?)\b\.?\s*#?\s*[A-Z0-9-]+\s*$/i,
      "",
    )
    .replace(/#\s*[A-Z0-9-]+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function houseNumberOf(streetAddress: string | null): string | null {
  return parseStreetAddress(streetAddress).house;
}
