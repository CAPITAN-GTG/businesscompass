import { enrichBusiness } from "@/lib/enrichment/enrich";
import { defaultSource } from "@/lib/sources";
import type { Business, BusinessEnrichment } from "@/lib/types/business";

/**
 * Full detail for one business: LA record, then optional OSM contact data.
 * Enrichment failures stay inside the result and never hide the LA record.
 */
export async function loadBusinessDetail(id: string): Promise<{
  business: Business | null;
  enrichment: BusinessEnrichment | null;
}> {
  const business = await defaultSource.getById(id);
  if (!business) return { business: null, enrichment: null };
  try {
    const enrichment = await enrichBusiness(business);
    return { business, enrichment };
  } catch {
    const enrichment: BusinessEnrichment = {
      phone: null,
      phoneDisplay: null,
      website: null,
      source: null,
      confidence: "none",
      status: "unavailable",
    };
    return { business, enrichment };
  }
}
