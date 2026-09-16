import {
  ageColorBandFromStartDate,
  ageColorFromStartDate,
  type AgeColorBand,
} from "@/lib/ageColor";
import { isInCalifornia } from "@/lib/geo";
import type { Business } from "@/lib/types/business";

export type PinRank = AgeColorBand;

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  color: string;
  rank: PinRank;
  name: string;
  startDate: string | null;
}

/** Convert API rows → map pins once per fetch (no Leaflet dependency). */
export function businessesToPins(businesses: Business[]): MapPin[] {
  const pins: MapPin[] = [];
  for (let i = 0; i < businesses.length; i++) {
    const b = businesses[i];
    const lat = b.latitude ? Number.parseFloat(b.latitude) : NaN;
    const lng = b.longitude ? Number.parseFloat(b.longitude) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isInCalifornia(lat, lng)) continue;
    const rank = ageColorBandFromStartDate(b.businessStartDate) ?? "yellow";
    pins.push({
      id: b.id,
      lat,
      lng,
      color: ageColorFromStartDate(b.businessStartDate),
      rank,
      name: b.businessName ?? "Unnamed business",
      startDate: b.businessStartDate,
    });
  }
  return pins;
}
