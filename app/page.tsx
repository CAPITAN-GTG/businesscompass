"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import type { Business } from "@/lib/types/business";
import {
  AGE_COLOR_FILTERS,
  DEFAULT_AGE_COLOR_BAND,
  ageColorFromStartDate,
  dateRangeForColorFilter,
  todayYmd,
  type AgeColorBand,
} from "@/lib/ageColor";
import { isInCalifornia, intersectMapBBoxWithCalifornia, type MapBBox, type UserLocation } from "@/lib/geo";
import { businessesToPins } from "@/lib/pins";
import {
  businessesInBBoxFromCache,
  clearSessionCache,
  isAreaLoaded,
  markAreaLoaded,
  markAreaTooDense,
  areaTooDenseCount,
  mergeBusinessesIntoCache,
  viewFilterKey,
} from "@/lib/viewCache";
import { geocodeCaliforniaPlace } from "@/lib/geocode";
import {
  MAP_DEFAULT_ZOOM,
  MAP_FIND_MIN_ZOOM,
  VIEW_FETCH_CHUNK,
  VIEW_FETCH_MAX_PER_RANK,
  VIEW_FETCH_MAX_TOTAL,
} from "@/lib/viewLimits";

const BusinessMap = dynamic(() => import("@/components/BusinessMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

const ROW_H = 52;
const LIST_PAGE_SIZE = 25;

type MapMode = "explore" | "locked";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function formatOneLineAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = parts.street?.trim() || "";
  const city = parts.city?.trim() || "";
  const state = parts.state?.trim() || "";
  const zip = parts.zip?.trim() || "";
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const line = [street, cityStateZip].filter(Boolean).join(", ");
  return line || null;
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{value && value.trim() !== "" ? value : "—"}</dd>
    </div>
  );
}

function DetailAddressField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const display = value && value.trim() !== "" ? value : null;

  async function copyAddress() {
    if (!display) return;
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  return (
    <div className="detail-field detail-address-field">
      <dt>{label}</dt>
      <dd>
        <span className="detail-address-text">{display ?? "—"}</span>
        {display ? (
          <button
            type="button"
            className="detail-copy"
            onClick={() => void copyAddress()}
            aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<MapMode>("explore");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [rankLoad, setRankLoad] = useState<{
    index: number;
    total: number;
  } | null>(null);
  /** When the active rank matched too many rows to load. */
  const [denseMatchCount, setDenseMatchCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Business | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "ready" | "denied" | "unavailable" | "outside_ca"
  >("idle");
  const [focusUserToken, setFocusUserToken] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [colorFilter, setColorFilter] = useState<AgeColorBand>(
    DEFAULT_AGE_COLOR_BAND,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  /** Live camera while exploring (or panning after a Find). */
  const [liveBBox, setLiveBBox] = useState<MapBBox | null>(null);
  const [liveZoom, setLiveZoom] = useState(MAP_DEFAULT_ZOOM);
  /** Committed search box — pins/list stay for this area until Keep looking. */
  const [lockedBBox, setLockedBBox] = useState<MapBBox | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeStatus, setPlaceStatus] = useState<
    "idle" | "searching" | "ok" | "approx" | "missing" | "outside"
  >("idle");
  const [placeMessage, setPlaceMessage] = useState<string | null>(null);
  const [placeFocus, setPlaceFocus] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [placeFocusToken, setPlaceFocusToken] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchGenRef = useRef(0);
  const lockedBBoxRef = useRef<MapBBox | null>(null);
  const modeRef = useRef<MapMode>(mode);
  lockedBBoxRef.current = lockedBBox;
  modeRef.current = mode;

  const pins = useMemo(() => businessesToPins(businesses), [businesses]);
  const byId = useMemo(() => {
    const m = new Map<string, Business>();
    for (const b of businesses) m.set(b.id, b);
    return m;
  }, [businesses]);

  const selected =
    detail && detail.id === selectedId
      ? detail
      : selectedId
        ? (byId.get(selectedId) ?? null)
        : null;

  const activeFilterMeta =
    AGE_COLOR_FILTERS.find((f) => f.id === colorFilter) ?? null;

  const onFetchError = useEffectEvent((message: string) => {
    fetchGenRef.current += 1;
    setBusinesses([]);
    setLoading(false);
    setRankLoad(null);
    setDenseMatchCount(null);
    setError(message);
    // Unlock so the user can zoom in / reframe and try again.
    setMode("explore");
    setLockedBBox(null);
  });

  const paintLocked = useEffectEvent((filter: AgeColorBand, bbox: MapBBox) => {
    const key = viewFilterKey(filter);
    const dense = areaTooDenseCount(key, bbox);
    if (dense != null) {
      setBusinesses([]);
      setDenseMatchCount(dense);
      return;
    }
    setDenseMatchCount(null);
    setBusinesses(businessesInBBoxFromCache(key, bbox));
  });

  /** Load one rank into the session cache (capped). Returns rows kept for that rank. */
  const fetchRankIntoCache = useCallback(
    async (
      gen: number,
      filter: AgeColorBand,
      bbox: MapBBox,
      cap: number,
    ): Promise<number> => {
      const filterKey = viewFilterKey(filter);
      if (cap <= 0) return 0;
      if (isAreaLoaded(filterKey, bbox)) {
        return 0;
      }

      const range = dateRangeForColorFilter(filter);
      const base: Record<string, string> = {
        sort: "start_date_desc",
        startDateTo: range.startDateTo,
        north: String(bbox.north),
        south: String(bbox.south),
        east: String(bbox.east),
        west: String(bbox.west),
        pageSize: String(Math.min(VIEW_FETCH_CHUNK, cap)),
      };
      if (range.startDateFrom) {
        base.startDateFrom = range.startDateFrom;
      }

      let page = 1;
      let expectedTotal: number | null = null;
      let loaded = 0;

      while (true) {
        if (gen !== fetchGenRef.current) return loaded;

        const pageSize = Math.min(VIEW_FETCH_CHUNK, cap - loaded);
        if (pageSize <= 0) break;

        const params = new URLSearchParams({
          ...base,
          page: String(page),
          pageSize: String(pageSize),
        });
        const res = await fetch(`/api/businesses?${params}`);
        const data = await res.json();
        if (gen !== fetchGenRef.current) return loaded;

        if (!res.ok) {
          if (data.code === "AREA_TOO_DENSE") {
            const n = Number(data.totalCount);
            markAreaTooDense(
              filterKey,
              bbox,
              Number.isFinite(n) ? n : VIEW_FETCH_MAX_PER_RANK + 1,
            );
            return 0;
          }
          throw new Error(
            data.error ||
              "Los Angeles business data is temporarily unavailable.",
          );
        }

        if (page === 1 && data.totalCount != null) {
          expectedTotal = Number(data.totalCount);
          if (
            Number.isFinite(expectedTotal) &&
            (expectedTotal as number) > VIEW_FETCH_MAX_PER_RANK
          ) {
            markAreaTooDense(filterKey, bbox, expectedTotal as number);
            return 0;
          }
        }

        const chunk = Array.isArray(data.businesses)
          ? (data.businesses as Business[])
          : [];

        if (chunk.length > 0) {
          const room = cap - loaded;
          const take = chunk.slice(0, room);
          // merge drops rows that don't classify into this rank (boundary-safe).
          loaded += mergeBusinessesIntoCache(filterKey, take);
        }

        const reachedTotal =
          expectedTotal != null && loaded >= expectedTotal;
        const shortPage = chunk.length < pageSize;
        const hitCap = loaded >= cap;
        if (reachedTotal || shortPage || hitCap || chunk.length === 0) {
          break;
        }

        page += 1;
        if (page > Math.ceil(VIEW_FETCH_MAX_PER_RANK / VIEW_FETCH_CHUNK) + 2) {
          break;
        }
      }

      markAreaLoaded(filterKey, bbox);
      return loaded;
    },
    [],
  );

  /** Find: load each rank one-by-one under a full-screen blocker, then show active. */
  const fetchAllRanksForArea = useCallback(
    async (active: AgeColorBand, bbox: MapBBox) => {
      const gen = ++fetchGenRef.current;
      const total = AGE_COLOR_FILTERS.length;
      setError(null);
      setLoading(true);
      setBusinesses([]);
      setDenseMatchCount(null);
      setRankLoad({ index: 0, total });

      let totalLoaded = 0;

      try {
        for (let i = 0; i < AGE_COLOR_FILTERS.length; i++) {
          const item = AGE_COLOR_FILTERS[i];
          if (gen !== fetchGenRef.current) return;
          if (totalLoaded >= VIEW_FETCH_MAX_TOTAL) break;

          setRankLoad({ index: i + 1, total });

          const remainingTotal = VIEW_FETCH_MAX_TOTAL - totalLoaded;
          const cap = Math.min(VIEW_FETCH_MAX_PER_RANK, remainingTotal);
          const added = await fetchRankIntoCache(gen, item.id, bbox, cap);
          if (gen !== fetchGenRef.current) return;
          totalLoaded += added;
        }

        if (gen !== fetchGenRef.current) return;
        setRankLoad(null);
        paintLocked(active, bbox);
        setLoading(false);
        setError(null);
      } catch (err) {
        if (gen !== fetchGenRef.current) return;
        setRankLoad(null);
        onFetchError(
          err instanceof Error
            ? err.message
            : "Los Angeles business data is temporarily unavailable.",
        );
      }
    },
    [fetchRankIntoCache],
  );

  /** Switch rank: cache hit instant; otherwise load that rank behind the blocker. */
  const ensureRankVisible = useCallback(
    async (filter: AgeColorBand, bbox: MapBBox) => {
      const gen = ++fetchGenRef.current;
      setError(null);

      if (isAreaLoaded(viewFilterKey(filter), bbox)) {
        paintLocked(filter, bbox);
        setLoading(false);
        setRankLoad(null);
        return;
      }

      setLoading(true);
      setBusinesses([]);
      setDenseMatchCount(null);
      setRankLoad({ index: 1, total: 1 });

      try {
        await fetchRankIntoCache(gen, filter, bbox, VIEW_FETCH_MAX_PER_RANK);
        if (gen !== fetchGenRef.current) return;
        setRankLoad(null);
        paintLocked(filter, bbox);
        setLoading(false);
      } catch (err) {
        if (gen !== fetchGenRef.current) return;
        setRankLoad(null);
        onFetchError(
          err instanceof Error
            ? err.message
            : "Los Angeles business data is temporarily unavailable.",
        );
      }
    },
    [fetchRankIntoCache],
  );

  const onViewChange = useEffectEvent(
    (view: { bbox: MapBBox; zoom: number }) => {
      setLiveBBox(view.bbox);
      setLiveZoom(view.zoom);
    },
  );

  const zoomOkForFind = liveZoom >= MAP_FIND_MIN_ZOOM;

  function renderThisArea() {
    if (!liveBBox || loading || !zoomOkForFind) return;
    const bbox = intersectMapBBoxWithCalifornia(liveBBox);
    if (!bbox) return;
    setLockedBBox(bbox);
    setMode("locked");
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
    if (listRef.current) listRef.current.scrollTop = 0;
    void fetchAllRanksForArea(colorFilter, bbox);
  }

  /** Find again for the current map view (clears session cache first). */
  function refreshThisArea() {
    if (!liveBBox || loading || !zoomOkForFind) return;
    const bbox = intersectMapBBoxWithCalifornia(liveBBox);
    if (!bbox) return;
    clearSessionCache();
    setLockedBBox(bbox);
    setMode("locked");
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
    if (listRef.current) listRef.current.scrollTop = 0;
    void fetchAllRanksForArea(colorFilter, bbox);
  }

  function keepLooking() {
    fetchGenRef.current += 1;
    clearSessionCache();
    setMode("explore");
    setLockedBBox(null);
    setBusinesses([]);
    setLoading(false);
    setRankLoad(null);
    setDenseMatchCount(null);
    setError(null);
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  async function searchPlace(e?: FormEvent) {
    e?.preventDefault();
    const q = placeQuery.trim();
    if (!q || placeStatus === "searching") return;

    setPlaceStatus("searching");
    setPlaceMessage(null);

    try {
      // New place search clears the previous Find session.
      if (mode === "locked") {
        fetchGenRef.current += 1;
        clearSessionCache();
        setMode("explore");
        setLockedBBox(null);
        setBusinesses([]);
        setLoading(false);
        setRankLoad(null);
        setDenseMatchCount(null);
        setError(null);
        setSelectedId(null);
        setDetail(null);
        setListPage(1);
      }

      const hit = await geocodeCaliforniaPlace(q);
      if (!hit) {
        setPlaceStatus("missing");
        setPlaceMessage(
          "Couldn’t find that place. Try a clearer address or city.",
        );
        return;
      }

      if (!hit.inCalifornia) {
        setPlaceStatus("outside");
        setPlaceMessage(
          "That looks outside California — this map only covers CA. Showing the closest match we found.",
        );
        // Still fly if we have coords but clamp message — user asked take to area it thinks.
        // Prefer not flying outside CA maxBounds (map will refuse). Skip fly.
        return;
      }

      setPlaceFocus({ lat: hit.lat, lng: hit.lng, zoom: MAP_DEFAULT_ZOOM });
      setPlaceFocusToken((n) => n + 1);
      setPlaceStatus("ok");
      setPlaceMessage(hit.label);
    } catch {
      setPlaceStatus("missing");
      setPlaceMessage("Search failed. Try again in a moment.");
    }
  }

  function setFilter(next: AgeColorBand) {
    setColorFilter(next);
  }

  // Rank switch while locked: show that rank (fetch if missing).
  useEffect(() => {
    if (modeRef.current !== "locked") return;
    const bbox = lockedBBoxRef.current;
    if (!bbox) return;
    void ensureRankVisible(colorFilter, bbox);
  }, [colorFilter, ensureRankVisible]);

  // Reset list chrome when rank changes while locked.
  useEffect(() => {
    if (modeRef.current !== "locked") return;
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [colorFilter]);

  // Load full business record when a pin/row is opened.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/businesses/${encodeURIComponent(selectedId)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setDetailError(data.error || "Could not load business details.");
          setDetailLoading(false);
          return;
        }
        setDetail(data.business as Business);
        setDetailLoading(false);
      } catch {
        if (cancelled) return;
        setDetailError("Could not load business details.");
        setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const applyUserPosition = useEffectEvent((coords: GeolocationCoordinates) => {
    const next: UserLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    };
    setUserLocation(next);
    if (!isInCalifornia(next.latitude, next.longitude)) {
      setGeoStatus("outside_ca");
      return;
    }
    setGeoStatus("ready");
  });

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: UserLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null,
        };
        setUserLocation(next);
        if (!isInCalifornia(next.latitude, next.longitude)) {
          setGeoStatus("outside_ca");
          return;
        }
        setGeoStatus("ready");
        setFocusUserToken((n) => n + 1);
      },
      (err) => {
        setGeoStatus(
          err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => applyUserPosition(pos.coords),
      (err) => {
        setGeoStatus(
          err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setShowAdvanced(false);
  }

  const listPageCount = Math.max(
    1,
    Math.ceil(businesses.length / LIST_PAGE_SIZE),
  );
  const safeListPage = Math.min(listPage, listPageCount);
  const listStart = (safeListPage - 1) * LIST_PAGE_SIZE;
  const slice = businesses.slice(listStart, listStart + LIST_PAGE_SIZE);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  const locateLabel =
    geoStatus === "locating"
      ? "Locating…"
      : geoStatus === "ready"
        ? "My location"
        : geoStatus === "outside_ca"
          ? "Outside CA"
          : geoStatus === "denied"
            ? "Location blocked"
            : "My location";

  const ageColor = selected
    ? ageColorFromStartDate(selected.businessStartDate)
    : null;

  const filterHint =
    mode === "explore"
      ? "Pick a time band, search a place, then find businesses in view."
      : activeFilterMeta
        ? `${activeFilterMeta.hint} · this Find area`
        : `Time in business vs today (${todayYmd()}).`;


  return (
    <main className="app">
      <aside
        className="panel"
        aria-label={selected ? "Business details" : "Business list"}
      >
        {selected ? (
          <div className="detail">
            <button type="button" className="detail-back" onClick={closeDetail}>
              ← Back
            </button>

            <header className="detail-header">
              {ageColor ? (
                <span
                  className="detail-pin-swatch"
                  style={{ background: ageColor }}
                  aria-hidden
                />
              ) : null}
              <div>
                <h1 className="detail-title">
                  {selected.businessName ?? "Unnamed business"}
                </h1>
                {selected.dbaName ? (
                  <p className="detail-dba">DBA: {selected.dbaName}</p>
                ) : null}
              </div>
            </header>

            {detailLoading ? (
              <p className="meta">Loading full details…</p>
            ) : null}
            {detailError ? (
              <p className="error" role="alert">
                {detailError}
              </p>
            ) : null}

            <section className="detail-section">
              <h2 className="detail-section-title">Identity</h2>
              <dl className="detail-section-body">
                <DetailField label="Account #" value={selected.id} />
                <DetailField
                  label="Legal name"
                  value={selected.businessName}
                />
                <DetailField label="DBA" value={selected.dbaName} />
              </dl>
            </section>

            <section className="detail-section">
              <h2 className="detail-section-title">Dates</h2>
              <dl className="detail-section-body">
                <DetailField
                  label="Start date"
                  value={formatDate(selected.businessStartDate)}
                />
              </dl>
            </section>

            <section className="detail-section">
              <h2 className="detail-section-title">Industry</h2>
              <dl className="detail-section-body">
                <DetailField label="Industry" value={selected.industry} />
              </dl>
            </section>

            <section className="detail-section">
              <h2 className="detail-section-title">Location</h2>
              <dl className="detail-section-body">
                <DetailAddressField
                  label="Address"
                  value={formatOneLineAddress({
                    street: selected.streetAddress,
                    city: selected.city,
                    state: selected.state,
                    zip: selected.zipCode,
                  })}
                />
              </dl>
            </section>

            <section className="detail-section">
              <h2 className="detail-section-title">Mailing</h2>
              <dl className="detail-section-body">
                <DetailAddressField
                  label="Address"
                  value={formatOneLineAddress({
                    street: selected.mailingAddress,
                    city: selected.mailingCity,
                    zip: selected.mailingZipCode,
                  })}
                />
              </dl>
            </section>

            <div className="detail-advanced">
              <button
                type="button"
                className="detail-advanced-toggle"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                Advanced {showAdvanced ? "▴" : "▾"}
              </button>
              {showAdvanced ? (
                <dl className="detail-section-body detail-advanced-body">
                  <DetailField
                    label="Location note"
                    value={selected.locationDescription}
                  />
                  <DetailField
                    label="End date"
                    value={formatDate(selected.businessEndDate)}
                  />
                  <DetailField label="NAICS" value={selected.naicsCode} />
                  <DetailField
                    label="Council district"
                    value={selected.councilDistrict}
                  />
                  <DetailField label="Latitude" value={selected.latitude} />
                  <DetailField label="Longitude" value={selected.longitude} />
                  <DetailField label="Source" value={selected.source} />
                  <DetailField label="Type" value={selected.sourceType} />
                </dl>
              ) : null}
            </div>

            <p className="detail-note">
              Start date is first registered location activity (Office of
              Finance), not California Secretary of State formation.
            </p>
          </div>
        ) : (
          <>
            <h1 className="brand">Business Compass</h1>
            <p className="sub">
              {mode === "explore"
                ? "Search a place on the map, then find businesses in view."
                : `Time in business · bands vs today (${todayYmd()}).`}
            </p>

            <div className="field">
              <span>Time in Business</span>
              <div
                className="color-filters"
                role="group"
                aria-label="Time in business"
              >
                {AGE_COLOR_FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      colorFilter === item.id
                        ? "color-filter is-active"
                        : "color-filter"
                    }
                    title={item.hint}
                    onClick={() => setFilter(item.id)}
                  >
                    <i style={{ background: item.color }} aria-hidden />
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="filter-hint">{filterHint}</p>
            </div>

            <div className="meta">
              <span>
                {mode === "explore"
                  ? "Exploring — no businesses loaded"
                  : loading
                    ? "Loading…"
                    : denseMatchCount != null
                      ? `${denseMatchCount.toLocaleString()} matched`
                      : `${pins.length.toLocaleString()} in this area`}
              </span>
            </div>

            {denseMatchCount != null && mode === "locked" && !loading ? (
              <p className="dense-note" role="status">
                Too many businesses in this rank for the current view (
                {denseMatchCount.toLocaleString()}). Zoom in and refresh.
              </p>
            ) : null}

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="list" ref={listRef}>
              {slice.map((b) => {
                const color = ageColorFromStartDate(b.businessStartDate);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className="row is-static"
                    style={{ height: ROW_H }}
                    onClick={() => setSelectedId(b.id)}
                  >
                    <i style={{ background: color }} />
                    <span>
                      <strong>{b.businessName ?? "Unnamed"}</strong>
                      <em>{formatDate(b.businessStartDate)}</em>
                    </span>
                  </button>
                );
              })}
            </div>

            {mode === "locked" && businesses.length > 0 ? (
              <div className="pager">
                <button
                  type="button"
                  disabled={safeListPage <= 1 || loading}
                  onClick={() => {
                    setListPage((p) => Math.max(1, p - 1));
                    if (listRef.current) listRef.current.scrollTop = 0;
                  }}
                >
                  Prev
                </button>
                <span>
                  {safeListPage} / {listPageCount}
                  <em className="pager-range">
                    {" "}
                    · {listStart + 1}–
                    {Math.min(listStart + LIST_PAGE_SIZE, businesses.length)}
                  </em>
                </span>
                <button
                  type="button"
                  disabled={safeListPage >= listPageCount || loading}
                  onClick={() => {
                    setListPage((p) => Math.min(listPageCount, p + 1));
                    if (listRef.current) listRef.current.scrollTop = 0;
                  }}
                >
                  Next
                </button>
              </div>
            ) : null}

            {mode === "locked" &&
            !loading &&
            !error &&
            denseMatchCount == null &&
            businesses.length === 0 ? (
              <p className="meta">No businesses in this Find area.</p>
            ) : null}
          </>
        )}
      </aside>

      <div className="map">
        {rankLoad ? (
          <div className="rank-load-overlay" role="status" aria-live="polite">
            <div className="rank-load-simple">
              <div
                className="rank-load-spinner"
                style={{
                  ["--rank-progress" as string]: String(
                    rankLoad.index / Math.max(1, rankLoad.total),
                  ),
                }}
                aria-hidden
              />
              <p className="rank-load-copy">
                Searching businesses in this area.
              </p>
            </div>
          </div>
        ) : null}
        <BusinessMap
          pins={mode === "explore" ? [] : pins}
          selectedId={selectedId}
          onSelect={setSelectedId}
          userLocation={userLocation}
          focusUserToken={focusUserToken}
          onViewChange={onViewChange}
          placeFocus={placeFocus}
          placeFocusToken={placeFocusToken}
        />
        <div className="map-top-left">
          <div className="map-toolbar">
            <form className="place-search" onSubmit={searchPlace}>
              <input
                type="search"
                value={placeQuery}
                onChange={(e) => {
                  setPlaceQuery(e.target.value);
                  if (placeStatus !== "idle" && placeStatus !== "searching") {
                    setPlaceStatus("idle");
                    setPlaceMessage(null);
                  }
                }}
                placeholder="Search address or place…"
                aria-label="Search address or place"
                disabled={placeStatus === "searching" || loading}
              />
              <button
                type="submit"
                disabled={
                  !placeQuery.trim() ||
                  placeStatus === "searching" ||
                  loading
                }
              >
                {placeStatus === "searching" ? "…" : "Go"}
              </button>
            </form>
            <div className="map-toolbar-actions">
              {mode === "explore" ? (
                <button
                  type="button"
                  className={
                    zoomOkForFind
                      ? "map-action-inline map-action-primary"
                      : "map-action-inline map-action-warn"
                  }
                  disabled={!liveBBox || loading || !zoomOkForFind}
                  onClick={renderThisArea}
                  title={
                    zoomOkForFind
                      ? "Find businesses in the current view"
                      : `Zoom in to ${MAP_FIND_MIN_ZOOM}+ to find businesses`
                  }
                >
                  {zoomOkForFind ? "Find businesses" : "Too zoomed out"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="map-action-inline"
                    disabled={loading}
                    onClick={keepLooking}
                  >
                    Keep looking
                  </button>
                  <button
                    type="button"
                    className="map-action-inline map-action-primary map-action-icon"
                    disabled={!liveBBox || loading || !zoomOkForFind}
                    onClick={refreshThisArea}
                    title={
                      zoomOkForFind
                        ? "Find businesses in the current view"
                        : `Zoom in to ${MAP_FIND_MIN_ZOOM}+ to refresh`
                    }
                    aria-label={
                      zoomOkForFind
                        ? "Refresh — find businesses in the current view"
                        : "Too zoomed out"
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      aria-hidden
                    >
                      <path
                        fill="currentColor"
                        d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
          {placeMessage ? (
            <p
              className={
                placeStatus === "ok"
                  ? "place-search-msg"
                  : "place-search-msg is-warn"
              }
              role="status"
            >
              {placeMessage}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="locate"
          onClick={locateMe}
          disabled={geoStatus === "locating"}
        >
          {locateLabel}
        </button>
      </div>
    </main>
  );
}
