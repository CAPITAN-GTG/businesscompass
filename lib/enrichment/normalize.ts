const LEGAL_SUFFIXES = new Set([
  "LLC",
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "LTD",
  "LIMITED",
  "LP",
  "LLP",
  "PC",
  "PLLC",
  "PLLP",
]);

/** Words that may trail a brand without being a different business. */
const GENERIC_NAME_TOKENS = new Set([
  "COFFEE",
  "CAFE",
  "SHOP",
  "STORE",
  "STORES",
  "MARKET",
  "RESTAURANT",
  "BAR",
  "GRILL",
  "BAKERY",
  "GROUP",
  "SERVICE",
  "SERVICES",
  "LOS",
  "ANGELES",
  "LA",
  "OF",
  "AND",
  "THE",
]);

const STREET_SUFFIXES: Record<string, string> = {
  STREET: "ST",
  STR: "ST",
  ST: "ST",
  AVENUE: "AVE",
  AVE: "AVE",
  BOULEVARD: "BLVD",
  BLVD: "BLVD",
  DRIVE: "DR",
  DR: "DR",
  ROAD: "RD",
  RD: "RD",
  LANE: "LN",
  LN: "LN",
  COURT: "CT",
  CT: "CT",
  PLACE: "PL",
  PL: "PL",
  TERRACE: "TER",
  TER: "TER",
  CIRCLE: "CIR",
  CIR: "CIR",
  PARKWAY: "PKWY",
  PKWY: "PKWY",
  HIGHWAY: "HWY",
  HWY: "HWY",
  TRAIL: "TRL",
  TRL: "TRL",
  WAY: "WAY",
};

const DIRECTIONS: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  N: "N",
  S: "S",
  E: "E",
  W: "W",
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW",
};

export interface NormalizedPhone {
  /** E.164, suitable for a tel: href. */
  e164: string;
  display: string;
}

export interface ParsedAddress {
  house: string | null;
  street: string | null;
  unit: string | null;
}

/** Collapse a business or DBA name for comparison. Empty string if nothing remains. */
export function normalizeBusinessName(value: string | null | undefined): string {
  if (!value) return "";
  const cleaned = value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/['’.]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (!cleaned) return "";

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens[0] === "THE") tokens.shift();
  return tokens.join(" ");
}

export function businessNameTokens(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

/** 0–1. 0 means "do not treat these as the same business". */
export function nameSimilarity(a: string | null, b: string | null): number {
  const left = normalizeBusinessName(a);
  const right = normalizeBusinessName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const subset = genericSubsetScore(left, right);
  if (subset > 0) return subset;

  const ratio = levenshteinRatio(left, right);
  if (left.length >= 4 && right.length >= 4 && ratio >= 0.9) return ratio;

  return 0;
}

/**
 * "STARBUCKS" vs "STARBUCKS COFFEE" — shorter name is fully contained and
 * the extra tokens are generic. A bare "PIZZA" inside "JOES PIZZA" is not.
 */
function genericSubsetScore(left: string, right: string): number {
  const a = businessNameTokens(left);
  const b = businessNameTokens(right);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 0) return 0;
  if (!shorter.every((token) => longer.includes(token))) return 0;
  if (!shorter.some((token) => token.length >= 5)) return 0;

  const extras = longer.filter((token) => !shorter.includes(token));
  if (extras.length === 0) return 1;
  if (extras.every((token) => GENERIC_NAME_TOKENS.has(token))) return 0.94;
  return 0;
}

export function levenshteinRatio(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - dist / max;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let next = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = next;
    next = swap;
  }
  return prev[b.length];
}

/**
 * First usable phone. OSM often stores several numbers separated by `;`.
 * US numbers become +1XXXXXXXXXX. Other international numbers stay E.164.
 */
export function normalizePhone(
  raw: string | null | undefined,
): NormalizedPhone | null {
  if (!raw) return null;
  const parts = raw.split(/[;|/]/);
  for (const part of parts) {
    const hit = normalizePhonePart(part);
    if (hit) return hit;
  }
  return null;
}

function normalizePhonePart(part: string): NormalizedPhone | null {
  let text = part.trim();
  if (!text) return null;

  text = text.replace(
    /(?:ext\.?|extension|x)\s*\d+\s*$/i,
    "",
  );
  // Letters other than the extension we already removed are not a phone.
  if (/[a-z]/i.test(text)) return null;

  const hasPlus = text.trim().startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus && digits.length === 10) {
    return formatNanp(digits);
  }
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) {
    return formatNanp(digits.slice(1));
  }
  if (hasPlus && digits.length === 11 && digits.startsWith("1")) {
    return formatNanp(digits.slice(1));
  }
  if (hasPlus && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("1")) {
    return { e164: `+${digits}`, display: `+${digits}` };
  }
  return null;
}

function formatNanp(ten: string): NormalizedPhone | null {
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return {
    e164: `+1${ten}`,
    display: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`,
  };
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;\s]/).map((s) => s.trim()).find(Boolean);
  if (!first || first.length > 300) return null;
  const withProto = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

export function normalizeZip(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

export function normalizeUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  const stripped = upper
    .replace(/^(SUITES?|STE|APTS?|APARTMENTS?|UNITS?)\b\.?\s*/i, "")
    .replace(/^#\s*/, "")
    .replace(/[^A-Z0-9]/g, "");
  return stripped || null;
}

export function parseStreetAddress(
  value: string | null | undefined,
): ParsedAddress {
  if (!value) return { house: null, street: null, unit: null };
  let text = value.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { house: null, street: null, unit: null };

  let unit: string | null = null;
  const unitMatch = text.match(
    /\b(?:SUITES?|STE|APTS?|APARTMENTS?|UNITS?)\b\.?\s*#?\s*([A-Z0-9-]+)\s*$/,
  );
  if (unitMatch && unitMatch.index != null) {
    unit = normalizeUnit(unitMatch[1]);
    text = text.slice(0, unitMatch.index).trim();
  } else {
    const hash = text.match(/#\s*([A-Z0-9-]+)\s*$/);
    if (hash && hash.index != null) {
      unit = normalizeUnit(hash[1]);
      text = text.slice(0, hash.index).trim();
    }
  }

  const houseMatch = text.match(/^(\d+[A-Z]?(?:-\d+[A-Z]?)?)\s+(.+)$/);
  if (!houseMatch) {
    return { house: null, street: normalizeStreetLine(text), unit };
  }

  return {
    house: houseMatch[1].replace(/^0+(?=\d)/, ""),
    street: normalizeStreetLine(houseMatch[2]),
    unit,
  };
}

function normalizeStreetLine(value: string): string | null {
  const tokens = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => DIRECTIONS[token] ?? STREET_SUFFIXES[token] ?? token);
  const line = tokens.join(" ").trim();
  return line || null;
}

export function streetSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return levenshteinRatio(a, b);
}

const LEADING_DIRECTION = /^(N|S|E|W|NE|NW|SE|SW)\s+/;

/**
 * Exact when the street lines match. A missing direction on one side
 * ("ALAMEDA ST" vs "N ALAMEDA ST") still counts as exact. Opposite
 * directions ("N MAIN" vs "S MAIN") do not.
 */
export function compareStreetNames(
  a: string | null,
  b: string | null,
): "exact" | "close" | "conflict" {
  if (!a || !b) return "conflict";
  if (a === b) return "exact";

  const dirA = a.match(LEADING_DIRECTION)?.[1] ?? null;
  const dirB = b.match(LEADING_DIRECTION)?.[1] ?? null;
  if (dirA && dirB && dirA !== dirB) return "conflict";

  const restA = a.replace(LEADING_DIRECTION, "");
  const restB = b.replace(LEADING_DIRECTION, "");
  if (restA === restB) return "exact";

  const ratio = Math.max(streetSimilarity(a, b), streetSimilarity(restA, restB));
  if (ratio >= 0.88) return "close";
  return "conflict";
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
