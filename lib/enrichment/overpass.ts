import { EXTERNAL_USER_AGENT } from "../external.ts";
import {
  OVERPASS_ENDPOINT,
  OVERPASS_MAX_ELEMENTS,
  OVERPASS_QUERY_TIMEOUT_S,
  OVERPASS_RADIUS_M,
  OVERPASS_TIMEOUT_MS,
} from "./config.ts";
import type { OsmCandidate } from "./match";

export type OverpassResult =
  | { ok: true; candidates: OsmCandidate[]; truncated: boolean }
  | { ok: false; reason: "timeout" | "rate_limit" | "http" | "bad_response" };

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/**
 * Nearby named OSM objects. Includes features without phone tags so a
 * same-name neighbor can block a weak match. Server-side only.
 */
export async function fetchNearbyOsm(
  lat: number,
  lng: number,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    radiusM?: number;
  },
): Promise<OverpassResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: "bad_response" };
  }

  const radius = options?.radiusM ?? OVERPASS_RADIUS_M;
  const query = `
[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}][maxsize:1000000];
(
  nwr(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})["name"];
  nwr(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})["brand"];
);
out tags center ${OVERPASS_MAX_ELEMENTS};
`.trim();

  const timeoutMs = options?.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = options?.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(OVERPASS_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": EXTERNAL_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (res.status === 429 || res.status === 406) {
      return { ok: false, reason: "rate_limit" };
    }
    if (!res.ok) return { ok: false, reason: "http" };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "bad_response" };
    }

    const elements = readElements(body);
    if (!elements) return { ok: false, reason: "bad_response" };

    const candidates = elements
      .map(candidateFromElement)
      .filter((row): row is OsmCandidate => row != null);

    return {
      ok: true,
      candidates,
      truncated: elements.length >= OVERPASS_MAX_ELEMENTS,
    };
  } catch (err) {
    if (isAbort(err)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "http" };
  } finally {
    clearTimeout(timer);
  }
}

export function candidateFromElement(el: OverpassElement): OsmCandidate | null {
  const tags = el.tags;
  if (!tags) return null;

  const names = unique(
    [tags.name, tags["official_name"], tags.brand, tags.operator, tags["alt_name"]]
      .flatMap((value) => (value ? value.split(";") : []))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!names.length) return null;

  const lat = finite(el.lat) ?? finite(el.center?.lat);
  const lng = finite(el.lon) ?? finite(el.center?.lon);
  if (lat == null || lng == null) return null;

  const id = `${el.type ?? "osm"}/${el.id ?? "unknown"}`;
  return {
    id,
    names,
    phones: unique(
      [tags.phone, tags["contact:phone"], tags["contact:mobile"]].filter(
        (value): value is string => Boolean(value && value.trim()),
      ),
    ),
    websites: unique(
      [tags.website, tags["contact:website"]].filter(
        (value): value is string => Boolean(value && value.trim()),
      ),
    ),
    houseNumber: tags["addr:housenumber"]?.trim() || null,
    street: tags["addr:street"]?.trim() || null,
    unit: tags["addr:unit"]?.trim() || tags["addr:flats"]?.trim() || null,
    postcode: tags["addr:postcode"]?.trim() || null,
    lat,
    lng,
  };
}

function readElements(body: unknown): OverpassElement[] | null {
  if (!body || typeof body !== "object") return null;
  const elements = (body as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;
  return elements.filter((row): row is OverpassElement => Boolean(row) && typeof row === "object");
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}
