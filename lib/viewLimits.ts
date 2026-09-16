/** Map / fetch guards so a wide viewport cannot crash the browser. */

/**
 * Explore / Keep-looking — free zoom-out while scouting surroundings
 * (no data loads until Find / Refresh at a tight enough view).
 */
export const MAP_MIN_ZOOM_EXPLORE = 6;

/** Find / Refresh only allowed at this zoom or closer. */
export const MAP_FIND_MIN_ZOOM = 12;

/** Starting zoom over LA. */
export const MAP_DEFAULT_ZOOM = 14;

/**
 * Rows per Socrata request. Larger = fewer round-trips; still streamed to the UI
 * one chunk at a time.
 */
export const VIEW_FETCH_CHUNK = 5_000;

/** Max businesses loaded for a single rank in one area. */
export const VIEW_FETCH_MAX_PER_RANK = 25_000;

/** Max businesses loaded across all ranks for one Find in an area. */
export const VIEW_FETCH_MAX_TOTAL = 50_000;
