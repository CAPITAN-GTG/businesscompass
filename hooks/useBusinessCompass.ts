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
import type { Business, BusinessEnrichment } from "@/lib/types/business";
import {
  AGE_COLOR_FILTERS,
  DEFAULT_AGE_COLOR_BAND,
  ageColorFromStartDate,
  dateRangeForColorFilter,
  todayYmd,
  type AgeColorBand,
} from "@/lib/ageColor";
import {
  isInCalifornia,
  intersectMapBBoxWithCalifornia,
  type MapBBox,
  type UserLocation,
} from "@/lib/geo";
import { refineMapCoordinates } from "@/lib/coordinates/refine";
import { businessesToPins } from "@/lib/pins";
import {
  businessesInBBoxFromCache,
  businessesInBBoxFromAllRanks,
  clearSessionCache,
  isAreaLoaded,
  markAreaLoaded,
  markAreaTooDense,
  areaTooDenseCount,
  mergeBusinessesIntoCache,
  releaseRankCacheIfFull,
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

export const LIST_PAGE_SIZE = 25;
export const ROW_H = 52;

export type MapMode = "explore" | "locked";
export type ColorFilter = AgeColorBand | "all";

export function useBusinessCompass() {
  const [mode, setMode] = useState<MapMode>("explore");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [rankLoad, setRankLoad] = useState<{
    index: number;
    total: number;
  } | null>(null);
  const [denseMatchCount, setDenseMatchCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Business | null>(null);
  const [enrichment, setEnrichment] = useState<BusinessEnrichment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "ready" | "denied" | "unavailable" | "outside_ca"
  >("idle");
  const [focusUserToken, setFocusUserToken] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [colorFilter, setColorFilter] = useState<ColorFilter>(
    DEFAULT_AGE_COLOR_BAND,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [liveBBox, setLiveBBox] = useState<MapBBox | null>(null);
  const [liveZoom, setLiveZoom] = useState(MAP_DEFAULT_ZOOM);
  const [lockedBBox, setLockedBBox] = useState<MapBBox | null>(null);
  const [fetchedTotal, setFetchedTotal] = useState(0);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeStatus, setPlaceStatus] = useState<
    "idle" | "searching" | "ok" | "missing" | "outside"
  >("idle");
  const [placeMessage, setPlaceMessage] = useState<string | null>(null);
  const [placeFocus, setPlaceFocus] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [placeFocusToken, setPlaceFocusToken] = useState(0);
  const fetchGenRef = useRef(0);
  const refineAbortRef = useRef<AbortController | null>(null);
  const colorFilterRef = useRef<ColorFilter>(colorFilter);
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

  const activeEnrichment =
    detail && detail.id === selectedId ? enrichment : null;

  const activeFilterMeta =
    colorFilter === "all"
      ? null
      : (AGE_COLOR_FILTERS.find((f) => f.id === colorFilter) ?? null);

  const canShowAll =
    mode === "locked" &&
    fetchedTotal > 0 &&
    fetchedTotal < VIEW_FETCH_MAX_PER_RANK;

  const onFetchError = useEffectEvent((message: string) => {
    fetchGenRef.current += 1;
    setBusinesses([]);
    setLoading(false);
    setRankLoad(null);
    setDenseMatchCount(null);
    setFetchedTotal(0);
    setError(message);
    setMode("explore");
    setLockedBBox(null);
  });

  const paintLocked = useEffectEvent((filter: ColorFilter, bbox: MapBBox) => {
    if (filter === "all") {
      setDenseMatchCount(null);
      setBusinesses(businessesInBBoxFromAllRanks(bbox));
      return;
    }
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

  const stopCoordinateRefine = useCallback(() => {
    refineAbortRef.current?.abort();
    refineAbortRef.current = null;
  }, []);

  const beginCoordinateRefine = useCallback((bbox: MapBBox) => {
    refineAbortRef.current?.abort();
    const controller = new AbortController();
    refineAbortRef.current = controller;
    void refineMapCoordinates({
      bbox,
      signal: controller.signal,
      onApplied: () => {
        const box = lockedBBoxRef.current;
        if (!box || modeRef.current !== "locked" || controller.signal.aborted) {
          return;
        }
        const filter = colorFilterRef.current;
        if (filter === "all") {
          setDenseMatchCount(null);
          setBusinesses(businessesInBBoxFromAllRanks(box));
          return;
        }
        const key = viewFilterKey(filter);
        const dense = areaTooDenseCount(key, box);
        if (dense != null) {
          setBusinesses([]);
          setDenseMatchCount(dense);
          return;
        }
        setDenseMatchCount(null);
        setBusinesses(businessesInBBoxFromCache(key, box));
      },
    });
  }, []);

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
      releaseRankCacheIfFull(filterKey, bbox);

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

  const fetchAllRanksForArea = useCallback(
    async (active: ColorFilter, bbox: MapBBox) => {
      stopCoordinateRefine();
      const gen = ++fetchGenRef.current;
      const total = AGE_COLOR_FILTERS.length;
      setError(null);
      setLoading(true);
      setBusinesses([]);
      setDenseMatchCount(null);
      setFetchedTotal(0);
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
        setFetchedTotal(totalLoaded);

        const underAllCap = totalLoaded < VIEW_FETCH_MAX_PER_RANK;
        let paint: ColorFilter = active;
        if (active === "all" && !underAllCap) {
          paint = DEFAULT_AGE_COLOR_BAND;
          setColorFilter(paint);
        }
        paintLocked(paint, bbox);
        setLoading(false);
        setError(null);
        beginCoordinateRefine(bbox);
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
    [fetchRankIntoCache, stopCoordinateRefine, beginCoordinateRefine],
  );

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
        beginCoordinateRefine(bbox);
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
    [fetchRankIntoCache, beginCoordinateRefine],
  );

  const onViewChange = useCallback(
    (view: { bbox: MapBBox; zoom: number }) => {
      setLiveBBox(view.bbox);
      setLiveZoom(view.zoom);
    },
    [],
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
    void fetchAllRanksForArea(colorFilter, bbox);
  }

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
    void fetchAllRanksForArea(colorFilter, bbox);
  }

  function keepLooking() {
    stopCoordinateRefine();
    fetchGenRef.current += 1;
    clearSessionCache();
    setMode("explore");
    setLockedBBox(null);
    setFetchedTotal(0);
    setBusinesses([]);
    setLoading(false);
    setRankLoad(null);
    setDenseMatchCount(null);
    setError(null);
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
  }

  async function searchPlace(e?: FormEvent) {
    e?.preventDefault();
    const q = placeQuery.trim();
    if (!q || placeStatus === "searching") return;

    setPlaceStatus("searching");
    setPlaceMessage(null);

    try {
      if (mode === "locked") {
        stopCoordinateRefine();
        fetchGenRef.current += 1;
        clearSessionCache();
        setMode("explore");
        setLockedBBox(null);
        setFetchedTotal(0);
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
        return;
      }

      setPlaceFocus({ lat: hit.lat, lng: hit.lng, zoom: hit.zoom });
      setPlaceFocusToken((n) => n + 1);
      setPlaceStatus("ok");
      setPlaceMessage(hit.label);
    } catch {
      setPlaceStatus("missing");
      setPlaceMessage("Search failed. Try again in a moment.");
    }
  }

  function setFilter(next: ColorFilter) {
    if (next === "all" && !canShowAll) return;
    setColorFilter(next);
  }

  useEffect(() => {
    colorFilterRef.current = colorFilter;
  }, [colorFilter]);

  useEffect(() => {
    if (modeRef.current !== "locked") return;
    const bbox = lockedBBoxRef.current;
    if (!bbox) return;
    if (colorFilter === "all") {
      paintLocked("all", bbox);
      setLoading(false);
      setRankLoad(null);
      return;
    }
    void ensureRankVisible(colorFilter, bbox);
  }, [colorFilter, ensureRankVisible]);

  useEffect(() => {
    if (colorFilter === "all" && !canShowAll) {
      setColorFilter(DEFAULT_AGE_COLOR_BAND);
    }
  }, [colorFilter, canShowAll]);

  useEffect(() => {
    if (modeRef.current !== "locked") return;
    setSelectedId(null);
    setDetail(null);
    setShowAdvanced(false);
    setListPage(1);
  }, [colorFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEnrichment(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setEnrichment(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/businesses/${encodeURIComponent(selectedId)}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as {
          error?: string;
          business?: Business;
          enrichment?: BusinessEnrichment;
        };
        if (controller.signal.aborted) return;
        if (!res.ok || !data.business) {
          setDetailError(data.error || "Could not load business details.");
          setDetailLoading(false);
          return;
        }
        setDetail(data.business);
        setEnrichment(data.enrichment ?? null);
        setDetailLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDetailError("Could not load business details.");
        setDetailLoading(false);
      }
    })();

    return () => {
      controller.abort();
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
    setEnrichment(null);
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
      : colorFilter === "all"
        ? `All ranks · ${fetchedTotal.toLocaleString()} loaded in this Find area`
        : activeFilterMeta
          ? `${activeFilterMeta.hint} · this Find area`
          : `Time in business vs today (${todayYmd()}).`;

  const statusLabel =
    mode === "explore"
      ? "Exploring — no businesses loaded"
      : loading
        ? "Loading…"
        : denseMatchCount != null
          ? `${denseMatchCount.toLocaleString()} matched`
          : `${pins.length.toLocaleString()} in this area`;

  return {
    mode,
    businesses,
    loading,
    rankLoad,
    denseMatchCount,
    error,
    selectedId,
    setSelectedId,
    detailLoading,
    detailError,
    enrichment: activeEnrichment,
    userLocation,
    geoStatus,
    focusUserToken,
    listPage,
    setListPage,
    colorFilter,
    showAdvanced,
    setShowAdvanced,
    placeQuery,
    setPlaceQuery,
    placeStatus,
    setPlaceStatus,
    placeMessage,
    setPlaceMessage,
    placeFocus,
    placeFocusToken,
    pins,
    selected,
    canShowAll,
    zoomOkForFind,
    liveBBox,
    renderThisArea,
    refreshThisArea,
    keepLooking,
    searchPlace,
    setFilter,
    locateMe,
    closeDetail,
    onViewChange,
    listPageCount,
    safeListPage,
    listStart,
    slice,
    locateLabel,
    ageColor,
    filterHint,
    statusLabel,
    fetchedTotal,
    activeFilterMeta,
  };
}

export type BusinessCompassState = ReturnType<typeof useBusinessCompass>;
