/**
 * Dev-only sample: compare Office of Finance coordinates with LA County CAMS.
 * Not used by the app. Run: node scripts/measure-cams.mjs
 *
 * Locator: CAMS_Pro_Locator_Precise on the County's current geocode host
 * (ArcGIS 12.1). It returns PointAddress matches. CAMS_AddressPoint_Locator
 * remains on the older 10.91 host and is not the service measured here.
 */

const SOCRATA =
  "https://data.lacity.org/resource/6rrh-rzua.json";
const CAMS =
  "https://geocode.gis.lacounty.gov/geocode/rest/services/CAMS_Pro_Locator_Precise/GeocodeServer/geocodeAddresses";

const SAMPLE = 80;

function stripUnit(address) {
  return address
    .replace(
      /\b(?:SUITES?|STE|APTS?|APARTMENTS?|UNITS?|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\b\.?\s*#?\s*[\w-]+\s*$/i,
      "",
    )
    .replace(/#\s*[\w-]+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function houseNumber(address) {
  const m = String(address || "").trim().match(/^(\d+[A-Z]?)/i);
  return m ? m[1].replace(/^0+(?=\d)/, "").toUpperCase() : null;
}

function zip5(value) {
  const d = String(value || "").replace(/\D/g, "");
  return d.length >= 5 ? d.slice(0, 5) : null;
}

function meters(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)));
  return s[i];
}

const listUrl = new URL(SOCRATA);
listUrl.searchParams.set(
  "$select",
  "location_account,business_name,street_address,city,zip_code,location_start_date,location_1",
);
listUrl.searchParams.set(
  "$where",
  "location_1 IS NOT NULL AND street_address IS NOT NULL AND upper(city)='LOS ANGELES' AND location_start_date >= '2025-06-01T00:00:00.000'",
);
listUrl.searchParams.set("$order", "location_start_date DESC");
listUrl.searchParams.set("$limit", String(SAMPLE));

const rows = await fetch(listUrl).then((r) => r.json());
if (!Array.isArray(rows)) {
  console.error(rows);
  process.exit(1);
}

const records = rows.map((row, i) => {
  const street = String(row.street_address || "");
  return {
    id: i + 1,
    account: row.location_account,
    name: row.business_name,
    street,
    building: stripUnit(street),
    city: row.city,
    zip: row.zip_code,
    started: row.location_start_date,
    lat: Number(row.location_1?.latitude),
    lng: Number(row.location_1?.longitude),
  };
});

const body = new URLSearchParams({
  f: "json",
  outSR: '{"wkid":4326}',
  addresses: JSON.stringify({
    records: records.map((row) => ({
      attributes: {
        OBJECTID: row.id,
        Address: row.building,
        City: "LOS ANGELES",
        Region: "CA",
        Postal: zip5(row.zip) || "",
      },
    })),
  }),
});

const started = Date.now();
const camsRes = await fetch(CAMS, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
  signal: AbortSignal.timeout(60_000),
});
const cams = await camsRes.json();
const elapsed = Date.now() - started;

if (cams.error) {
  console.error(cams.error);
  process.exit(1);
}

const byId = new Map(
  (cams.locations || []).map((loc) => [Number(loc.attributes?.ResultID), loc]),
);

const distances = [];
const confident = [];
const outliers = [];
let noCandidate = 0;
let lowScore = 0;
let wrongType = 0;
let houseMismatch = 0;
let zipMismatch = 0;
let zeroOrigin = 0;
let usableOrigin = 0;
const typeCounts = {};

for (const row of records) {
  const loc = byId.get(row.id);
  const attr = loc?.attributes || {};
  const score = Number(loc?.score ?? attr.Score);
  const status = attr.Status;
  if (!loc || status !== "M" || !Number.isFinite(score)) {
    noCandidate += 1;
    continue;
  }
  const camsLat = Number(loc.location?.y);
  const camsLng = Number(loc.location?.x);
  if (!Number.isFinite(camsLat) || !Number.isFinite(camsLng)) {
    noCandidate += 1;
    continue;
  }
  const usableLa =
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lng) &&
    !(row.lat === 0 && row.lng === 0) &&
    row.lat > 32 &&
    row.lat < 43 &&
    row.lng < -114 &&
    row.lng > -125;
  const dist = usableLa ? meters(row.lat, row.lng, camsLat, camsLng) : null;
  const addNum = houseNumber(attr.Match_addr) || String(attr.AddNum || "").toUpperCase();
  const house = houseNumber(row.building);
  const camsZip = zip5(attr.Postal);
  const ourZip = zip5(row.zip);
  const typeOk = attr.Addr_type === "PointAddress" || attr.Addr_type === "Subaddress";
  const houseOk = Boolean(house && addNum && house === addNum.replace(/^0+(?=\d)/, ""));
  const zipOk = !camsZip || !ourZip || camsZip === ourZip;
  const scoreOk = score >= 90;
  const item = {
    name: row.name,
    street: row.street,
    score,
    type: attr.Addr_type,
    match: attr.Match_addr,
    dist: dist == null ? null : Math.round(dist),
    house,
    addNum,
    zip: ourZip,
    camsZip,
  };
  typeCounts[attr.Addr_type || ""] = (typeCounts[attr.Addr_type || ""] || 0) + 1;
  if (!usableLa) zeroOrigin += 1;
  else usableOrigin += 1;
  if (dist != null) distances.push(dist);
  if (!scoreOk) {
    lowScore += 1;
    continue;
  }
  if (!typeOk) {
    wrongType += 1;
    continue;
  }
  if (!houseOk) {
    houseMismatch += 1;
    if (dist != null && dist > 500) outliers.push({ reason: "house", ...item });
    continue;
  }
  if (!zipOk) {
    zipMismatch += 1;
    continue;
  }
  confident.push(item);
  if (dist != null && dist > 200) outliers.push({ reason: "far", ...item });
}

const confDists = confident.map((c) => c.dist).filter((n) => n != null);

console.log(JSON.stringify({
  sample: records.length,
  rawZeroCoordinates: records.filter((r) => r.lat === 0 && r.lng === 0).length,
  camsHttp: camsRes.status,
  batchMs: elapsed,
  returned: (cams.locations || []).length,
  noCandidate,
  lowScore,
  wrongType,
  houseMismatch,
  zipMismatch,
  confident: confident.length,
  medianUsableMeters: median(distances),
  zeroOriginAmongMatches: zeroOrigin,
  usableOriginAmongMatches: usableOrigin,
  addrTypes: typeCounts,
  closeExamples: confident.filter((c) => c.dist != null && c.dist <= 100).sort((a, b) => a.dist - b.dist).slice(0, 8),
  medianConfidentMeters: median(confDists),
  p90ConfidentMeters: percentile(confDists, 90),
  within25m: confDists.filter((d) => d <= 25).length,
  within50m: confDists.filter((d) => d <= 50).length,
  within100m: confDists.filter((d) => d <= 100).length,
  over200m: confDists.filter((d) => d > 200).length,
  over1000m: confDists.filter((d) => d > 1000).length,
  outlierExamples: outliers.sort((a, b) => (b.dist || 0) - (a.dist || 0)).slice(0, 12),
}, null, 2));
