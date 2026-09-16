import type {
  Business,
  BusinessListResult,
  BusinessQuery,
  BusinessSourceMeta,
} from "@/lib/types/business";

/**
 * Common interface for business data sources.
 * Future sources (other cities, county, CA SOS bulk) should implement this.
 */
export interface BusinessSource {
  meta: BusinessSourceMeta;
  list(query: BusinessQuery): Promise<BusinessListResult>;
  getById(id: string): Promise<Business | null>;
}
