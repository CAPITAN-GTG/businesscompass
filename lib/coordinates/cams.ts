import { CAMS_GEOCODE_URL, CAMS_TIMEOUT_MS } from "./config.ts";
import type { CamsCandidate } from "./decide.ts";

export interface CamsAddressInput {
  id: number;
  address: string;
  city: string | null;
  postal: string | null;
}

interface CamsLocation {
  score?: number;
  location?: { x?: number; y?: number };
  attributes?: {
    ResultID?: number;
    Status?: string;
    Score?: number;
    Match_addr?: string;
    Addr_type?: string;
  };
}

interface CamsBatchBody {
  spatialReference?: { wkid?: number; latestWkid?: number };
  locations?: CamsLocation[];
  error?: { message?: string };
}

const SLOT_KEY = Symbol.for("businesscompass.camsSlot");

interface CamsSlot {
  tail: Promise<void>;
}

function slot(): CamsSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: CamsSlot };
  if (!g[SLOT_KEY]) g[SLOT_KEY] = { tail: Promise.resolve() };
  return g[SLOT_KEY];
}

/** One batch at a time for this server process. */
function withCamsSlot<T>(fn: () => Promise<T>): Promise<T> {
  const current = slot();
  const run = current.tail.then(fn, fn);
  current.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function wgs84(body: CamsBatchBody): boolean {
  const sr = body.spatialReference;
  const code = sr?.latestWkid ?? sr?.wkid;
  return code === 4326 || code === 4269;
}

/**
 * Batch geocode. Returns one candidate per input id, or null when CAMS had
 * no location for that id. Throws when the service is unusable so callers
 * can fall back without caching a permanent miss.
 */
export async function geocodeCamsBatch(
  inputs: CamsAddressInput[],
): Promise<Map<number, CamsCandidate | null>> {
  if (inputs.length === 0) return new Map();
  return withCamsSlot(() => geocodeOnce(inputs));
}

async function geocodeOnce(
  inputs: CamsAddressInput[],
): Promise<Map<number, CamsCandidate | null>> {
  const records = {
    records: inputs.map((item) => ({
      attributes: {
        OBJECTID: item.id,
        Address: item.address,
        City: item.city || "",
        Region: "CA",
        Postal: item.postal || "",
      },
    })),
  };

  const body = new URLSearchParams();
  body.set("f", "json");
  body.set("outSR", JSON.stringify({ wkid: 4326 }));
  body.set("addresses", JSON.stringify(records));

  const response = await fetch(CAMS_GEOCODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(CAMS_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`CAMS geocoder returned ${response.status}`);
  }

  const payload = (await response.json()) as CamsBatchBody;
  if (payload.error) {
    throw new Error(payload.error.message || "CAMS geocoder error");
  }
  if (!wgs84(payload) || !Array.isArray(payload.locations)) {
    throw new Error("CAMS geocoder did not return WGS84 locations");
  }

  const found = new Map<number, CamsCandidate | null>();
  for (const item of inputs) found.set(item.id, null);

  for (const location of payload.locations) {
    const id = location.attributes?.ResultID;
    if (id == null || !found.has(id)) continue;
    const x = location.location?.x;
    const y = location.location?.y;
    const score = location.attributes?.Score ?? location.score ?? 0;
    found.set(id, {
      status: location.attributes?.Status ?? "",
      score: Number(score),
      addrType: location.attributes?.Addr_type ?? "",
      matchAddress: location.attributes?.Match_addr ?? "",
      latitude: typeof y === "number" ? y : Number.NaN,
      longitude: typeof x === "number" ? x : Number.NaN,
    });
  }

  return found;
}
