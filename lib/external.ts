/**
 * Identifying User-Agent for public OSM services (Nominatim, Overpass).
 * Their usage policies require a specific application identity, not a library default.
 */
export const EXTERNAL_USER_AGENT =
  "BusinessCompass/0.1 (personal LA business map; cached OSM consumer)";
