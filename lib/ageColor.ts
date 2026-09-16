/**
 * Age rank bands vs today (location start date).
 *
 * Boundaries are calendar YMD cutoffs shared by API filters and pin coloring,
 * so a business cannot “leak” into a neighboring rank from float age drift.
 */

type Rgb = readonly [number, number, number];

const YELLOW: Rgb = [234, 179, 8];
const GREEN: Rgb = [22, 163, 74];
const ORANGE: Rgb = [249, 115, 22];
const RED: Rgb = [220, 38, 38];
const PURPLE: Rgb = [126, 34, 206];
const BLACK: Rgb = [0, 0, 0];
const UNKNOWN: Rgb = [148, 163, 174];

export type AgeColorBand =
  | "yellow"
  | "green"
  | "orange"
  | "red"
  | "purple"
  | "black";

function rgb(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayYmd(): string {
  return toYmd(new Date());
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

/** YYYY-MM-DD from an ISO timestamp (or null). */
export function startDateYmd(iso: string | null): string | null {
  if (!iso) return null;
  const ymd = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/**
 * Inclusive calendar windows for each rank — single source of truth for
 * SoQL filters and client-side band assignment.
 *
 * yellow: [1y ago, today]
 * green:  [3y ago, 1y ago − 1 day]
 * orange: [5y ago, 3y ago − 1 day]
 * red:    [10y ago, 5y ago − 1 day]
 * purple: [20y ago, 10y ago − 1 day]
 * black:  (−∞, 20y ago]
 */
export function rankDateCutoffs(now = new Date()): {
  today: string;
  y1: string;
  y3: string;
  y5: string;
  y10: string;
  y20: string;
  dayBeforeY1: string;
  dayBeforeY3: string;
  dayBeforeY5: string;
  dayBeforeY10: string;
} {
  const today = toYmd(now);
  const y1 = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 1);
    return toYmd(d);
  })();
  const y3 = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 3);
    return toYmd(d);
  })();
  const y5 = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 5);
    return toYmd(d);
  })();
  const y10 = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 10);
    return toYmd(d);
  })();
  const y20 = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 20);
    return toYmd(d);
  })();

  return {
    today,
    y1,
    y3,
    y5,
    y10,
    y20,
    dayBeforeY1: addDaysYmd(y1, -1),
    dayBeforeY3: addDaysYmd(y3, -1),
    dayBeforeY5: addDaysYmd(y5, -1),
    dayBeforeY10: addDaysYmd(y10, -1),
  };
}

function ymdInInclusiveRange(
  ymd: string,
  from: string | null,
  to: string,
): boolean {
  if (ymd > to) return false;
  if (from != null && ymd < from) return false;
  return true;
}

/**
 * Assign rank from the same YMD windows the API uses — never float “years”.
 */
export function ageColorBandFromStartDate(
  iso: string | null,
): AgeColorBand | null {
  const ymd = startDateYmd(iso);
  if (!ymd) return null;

  const c = rankDateCutoffs();
  // Future / planned starts are excluded from Find queries; ignore here too.
  if (ymd > c.today) return null;

  if (ymdInInclusiveRange(ymd, c.y1, c.today)) return "yellow";
  if (ymdInInclusiveRange(ymd, c.y3, c.dayBeforeY1)) return "green";
  if (ymdInInclusiveRange(ymd, c.y5, c.dayBeforeY3)) return "orange";
  if (ymdInInclusiveRange(ymd, c.y10, c.dayBeforeY5)) return "red";
  if (ymdInInclusiveRange(ymd, c.y20, c.dayBeforeY10)) return "purple";
  if (ymd <= c.y20) return "black";
  return null;
}

export function ageColorFromStartDate(iso: string | null): string {
  const band = ageColorBandFromStartDate(iso);
  if (band === "yellow") return rgb(YELLOW);
  if (band === "green") return rgb(GREEN);
  if (band === "orange") return rgb(ORANGE);
  if (band === "red") return rgb(RED);
  if (band === "purple") return rgb(PURPLE);
  if (band === "black") return rgb(BLACK);
  return rgb(UNKNOWN);
}

/** API date window for a single rank — mirrors ageColorBandFromStartDate. */
export function dateRangeForColorFilter(filter: AgeColorBand): {
  startDateFrom?: string;
  startDateTo: string;
} {
  const c = rankDateCutoffs();

  switch (filter) {
    case "yellow":
      return { startDateFrom: c.y1, startDateTo: c.today };
    case "green":
      return { startDateFrom: c.y3, startDateTo: c.dayBeforeY1 };
    case "orange":
      return { startDateFrom: c.y5, startDateTo: c.dayBeforeY3 };
    case "red":
      return { startDateFrom: c.y10, startDateTo: c.dayBeforeY5 };
    case "purple":
      return { startDateFrom: c.y20, startDateTo: c.dayBeforeY10 };
    case "black":
      return { startDateTo: c.y20 };
  }
}

export const AGE_COLOR_FILTERS: {
  id: AgeColorBand;
  label: string;
  hint: string;
  color: string;
}[] = [
  {
    id: "yellow",
    label: "0–1y",
    hint: "Started today through 1 year ago",
    color: rgb(YELLOW),
  },
  {
    id: "green",
    label: "1–3y",
    hint: "Started 1 year + 1 day through 3 years ago",
    color: rgb(GREEN),
  },
  {
    id: "orange",
    label: "3–5y",
    hint: "Started 3 years + 1 day through 5 years ago",
    color: rgb(ORANGE),
  },
  {
    id: "red",
    label: "5–10y",
    hint: "Started 5 years + 1 day through 10 years ago",
    color: rgb(RED),
  },
  {
    id: "purple",
    label: "10–20y",
    hint: "Started 10 years + 1 day through 20 years ago",
    color: rgb(PURPLE),
  },
  {
    id: "black",
    label: "20y+",
    hint: "Started 20+ years ago",
    color: rgb(BLACK),
  },
];

export const DEFAULT_AGE_COLOR_BAND: AgeColorBand = "yellow";
