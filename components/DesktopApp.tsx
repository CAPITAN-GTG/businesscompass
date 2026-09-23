"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  AGE_COLOR_FILTERS,
  ageColorFromStartDate,
  todayYmd,
} from "@/lib/ageColor";
import { MAP_FIND_MIN_ZOOM } from "@/lib/viewLimits";
import { BusinessDetailPanel, formatDate } from "@/components/BusinessDetailPanel";
import {
  LIST_PAGE_SIZE,
  ROW_H,
  useBusinessCompass,
} from "@/hooks/useBusinessCompass";

const BusinessMap = dynamic(() => import("@/components/BusinessMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

export default function DesktopApp() {
  const c = useBusinessCompass();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [c.listPage, c.colorFilter, c.mode]);

  return (
    <main className="app">
      <aside
        className="panel"
        aria-label={c.selected ? "Business details" : "Business list"}
      >
        {c.selected ? (
          <BusinessDetailPanel
            selected={c.selected}
            ageColor={c.ageColor}
            detailLoading={c.detailLoading}
            detailError={c.detailError}
            showAdvanced={c.showAdvanced}
            setShowAdvanced={c.setShowAdvanced}
            onClose={c.closeDetail}
          />
        ) : (
          <>
            <h1 className="brand">Business Compass</h1>
            <p className="sub">
              {c.mode === "explore"
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
                {c.canShowAll ? (
                  <button
                    type="button"
                    className={
                      c.colorFilter === "all"
                        ? "color-filter is-active"
                        : "color-filter"
                    }
                    title="Show every loaded rank in this Find area"
                    onClick={() => c.setFilter("all")}
                  >
                    All
                  </button>
                ) : null}
                {AGE_COLOR_FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      c.colorFilter === item.id
                        ? "color-filter is-active"
                        : "color-filter"
                    }
                    title={item.hint}
                    onClick={() => c.setFilter(item.id)}
                  >
                    <i style={{ background: item.color }} aria-hidden />
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="filter-hint">{c.filterHint}</p>
            </div>

            <div className="meta">
              <span>{c.statusLabel}</span>
            </div>

            {c.denseMatchCount != null && c.mode === "locked" && !c.loading ? (
              <p className="dense-note" role="status">
                Too many businesses in this rank for the current view (
                {c.denseMatchCount.toLocaleString()}). Zoom in and refresh.
              </p>
            ) : null}

            {c.error ? (
              <p className="error" role="alert">
                {c.error}
              </p>
            ) : null}

            <div className="list" ref={listRef}>
              {c.slice.map((b) => {
                const color = ageColorFromStartDate(b.businessStartDate);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className="row is-static"
                    style={{ height: ROW_H }}
                    onClick={() => c.setSelectedId(b.id)}
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

            {c.mode === "locked" && c.businesses.length > 0 ? (
              <div className="pager">
                <button
                  type="button"
                  disabled={c.safeListPage <= 1 || c.loading}
                  onClick={() => c.setListPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span>
                  {c.safeListPage} / {c.listPageCount}
                  <em className="pager-range">
                    {" "}
                    · {c.listStart + 1}–
                    {Math.min(c.listStart + LIST_PAGE_SIZE, c.businesses.length)}
                  </em>
                </span>
                <button
                  type="button"
                  disabled={c.safeListPage >= c.listPageCount || c.loading}
                  onClick={() =>
                    c.setListPage((p) => Math.min(c.listPageCount, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            ) : null}

            {c.mode === "locked" &&
            !c.loading &&
            !c.error &&
            c.denseMatchCount == null &&
            c.businesses.length === 0 ? (
              <p className="meta">No businesses in this Find area.</p>
            ) : null}
          </>
        )}
      </aside>

      <div className="map">
        {c.rankLoad ? (
          <div className="rank-load-overlay" role="status" aria-live="polite">
            <div className="rank-load-simple">
              <div
                className="rank-load-spinner"
                style={{
                  ["--rank-progress" as string]: String(
                    c.rankLoad.index / Math.max(1, c.rankLoad.total),
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
          pins={c.mode === "explore" ? [] : c.pins}
          selectedId={c.selectedId}
          onSelect={c.setSelectedId}
          userLocation={c.userLocation}
          focusUserToken={c.focusUserToken}
          onViewChange={c.onViewChange}
          placeFocus={c.placeFocus}
          placeFocusToken={c.placeFocusToken}
        />
        <div className="map-top-left">
          <div className="map-toolbar">
            <form className="place-search" onSubmit={c.searchPlace}>
              <input
                type="search"
                value={c.placeQuery}
                onChange={(e) => {
                  c.setPlaceQuery(e.target.value);
                  if (
                    c.placeStatus !== "idle" &&
                    c.placeStatus !== "searching"
                  ) {
                    c.setPlaceStatus("idle");
                    c.setPlaceMessage(null);
                  }
                }}
                placeholder="Search address or place…"
                aria-label="Search address or place"
                disabled={c.placeStatus === "searching" || c.loading}
              />
              <button
                type="submit"
                disabled={
                  !c.placeQuery.trim() ||
                  c.placeStatus === "searching" ||
                  c.loading
                }
              >
                {c.placeStatus === "searching" ? "…" : "Go"}
              </button>
            </form>
            <div className="map-toolbar-actions">
              {c.mode === "explore" ? (
                <button
                  type="button"
                  className={
                    c.zoomOkForFind
                      ? "map-action-inline map-action-primary"
                      : "map-action-inline map-action-warn"
                  }
                  disabled={!c.liveBBox || c.loading || !c.zoomOkForFind}
                  onClick={c.renderThisArea}
                  title={
                    c.zoomOkForFind
                      ? "Find businesses in the current view"
                      : `Zoom in to ${MAP_FIND_MIN_ZOOM}+ to find businesses`
                  }
                >
                  {c.zoomOkForFind ? "Find businesses" : "Too zoomed out"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="map-action-inline"
                    disabled={c.loading}
                    onClick={c.keepLooking}
                  >
                    Keep looking
                  </button>
                  <button
                    type="button"
                    className="map-action-inline map-action-primary map-action-icon"
                    disabled={!c.liveBBox || c.loading || !c.zoomOkForFind}
                    onClick={c.refreshThisArea}
                    title={
                      c.zoomOkForFind
                        ? "Find businesses in the current view"
                        : `Zoom in to ${MAP_FIND_MIN_ZOOM}+ to refresh`
                    }
                    aria-label={
                      c.zoomOkForFind
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
          {c.placeMessage ? (
            <p
              className={
                c.placeStatus === "ok"
                  ? "place-search-msg"
                  : "place-search-msg is-warn"
              }
              role="status"
            >
              {c.placeMessage}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="locate"
          onClick={c.locateMe}
          disabled={c.geoStatus === "locating"}
        >
          {c.locateLabel}
        </button>
      </div>
    </main>
  );
}
