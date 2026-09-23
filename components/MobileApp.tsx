"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AGE_COLOR_FILTERS,
  ageColorFromStartDate,
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

type SheetMode = "peek" | "half" | "full";

export default function MobileApp() {
  const c = useBusinessCompass();
  const listRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<SheetMode>("peek");

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [c.listPage, c.colorFilter, c.mode]);

  // Open the sheet when results arrive or a pin is selected.
  useEffect(() => {
    if (c.selectedId) {
      setSheet("full");
      return;
    }
    if (c.mode === "locked" && !c.loading) {
      setSheet((s) => (s === "peek" ? "half" : s));
    }
  }, [c.selectedId, c.mode, c.loading]);

  function toggleSheet() {
    if (c.selectedId) return;
    setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
  }

  function selectBusiness(id: string) {
    c.setSelectedId(id);
    setSheet("full");
  }

  function closeDetail() {
    c.closeDetail();
    setSheet(c.mode === "locked" ? "half" : "peek");
  }

  const sheetClass =
    sheet === "full"
      ? "m-sheet is-full"
      : sheet === "half"
        ? "m-sheet is-half"
        : "m-sheet is-peek";

  return (
    <main className="m-app">
      <div className="m-map">
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
          onSelect={(id) => {
            if (id) selectBusiness(id);
            else if (c.selectedId) closeDetail();
          }}
          userLocation={c.userLocation}
          focusUserToken={c.focusUserToken}
          onViewChange={c.onViewChange}
          placeFocus={c.placeFocus}
          placeFocusToken={c.placeFocusToken}
          touchFriendly
          hideZoomDebug
        />

        <div className="m-top">
          <form className="m-search" onSubmit={c.searchPlace}>
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="street-address"
              value={c.placeQuery}
              onChange={(e) => {
                c.setPlaceQuery(e.target.value);
                if (c.placeStatus !== "idle" && c.placeStatus !== "searching") {
                  c.setPlaceStatus("idle");
                  c.setPlaceMessage(null);
                }
              }}
              placeholder="Address or place"
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

          {c.placeMessage ? (
            <p
              className={
                c.placeStatus === "ok"
                  ? "m-place-msg"
                  : "m-place-msg is-warn"
              }
              role="status"
            >
              {c.placeMessage}
            </p>
          ) : null}

          <div className="m-actions">
            {c.mode === "explore" ? (
              <button
                type="button"
                className={
                  c.zoomOkForFind
                    ? "m-action m-action-primary"
                    : "m-action m-action-warn"
                }
                disabled={!c.liveBBox || c.loading || !c.zoomOkForFind}
                onClick={() => {
                  c.renderThisArea();
                  setSheet("half");
                }}
              >
                {c.zoomOkForFind
                  ? "Find in view"
                  : `Zoom in (≥${MAP_FIND_MIN_ZOOM})`}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="m-action"
                  disabled={c.loading}
                  onClick={() => {
                    c.keepLooking();
                    setSheet("peek");
                  }}
                >
                  Keep looking
                </button>
                <button
                  type="button"
                  className="m-action m-action-primary"
                  disabled={!c.liveBBox || c.loading || !c.zoomOkForFind}
                  onClick={() => {
                    c.refreshThisArea();
                    setSheet("half");
                  }}
                >
                  Refresh
                </button>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className="m-locate"
          onClick={c.locateMe}
          disabled={c.geoStatus === "locating"}
          aria-label={c.locateLabel}
          title={c.locateLabel}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              fill="currentColor"
              d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
            />
          </svg>
        </button>
      </div>

      <section
        className={sheetClass}
        aria-label={c.selected ? "Business details" : "Results"}
      >
        <button
          type="button"
          className="m-sheet-handle"
          onClick={toggleSheet}
          aria-label={
            sheet === "peek"
              ? "Expand results"
              : sheet === "half"
                ? "Expand further"
                : "Collapse results"
          }
        >
          <span />
        </button>

        {c.selected ? (
          <BusinessDetailPanel
            selected={c.selected}
            ageColor={c.ageColor}
            detailLoading={c.detailLoading}
            detailError={c.detailError}
            showAdvanced={c.showAdvanced}
            setShowAdvanced={c.setShowAdvanced}
            onClose={closeDetail}
            className="m-detail"
          />
        ) : (
          <div className="m-sheet-body">
            <header className="m-sheet-head">
              <div>
                <p className="m-brand">Business Compass</p>
                <p className="m-status">{c.statusLabel}</p>
              </div>
              {sheet !== "peek" ? (
                <button
                  type="button"
                  className="m-sheet-collapse"
                  onClick={() => setSheet("peek")}
                >
                  Map
                </button>
              ) : null}
            </header>

            <div
              className="m-filters"
              role="group"
              aria-label="Time in business"
            >
              {c.canShowAll ? (
                <button
                  type="button"
                  className={
                    c.colorFilter === "all" ? "m-chip is-active" : "m-chip"
                  }
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
                    c.colorFilter === item.id ? "m-chip is-active" : "m-chip"
                  }
                  title={item.hint}
                  onClick={() => c.setFilter(item.id)}
                >
                  <i style={{ background: item.color }} aria-hidden />
                  {item.label}
                </button>
              ))}
            </div>

            {sheet === "peek" ? (
              <p className="m-peek-hint">
                {c.mode === "explore"
                  ? "Pan the map, then Find in view."
                  : "Tap the handle for the list."}
              </p>
            ) : (
              <>
                {c.denseMatchCount != null &&
                c.mode === "locked" &&
                !c.loading ? (
                  <p className="dense-note" role="status">
                    Too many in this rank (
                    {c.denseMatchCount.toLocaleString()}). Zoom in and
                    refresh.
                  </p>
                ) : null}

                {c.error ? (
                  <p className="error" role="alert">
                    {c.error}
                  </p>
                ) : null}

                <div className="m-list" ref={listRef}>
                  {c.slice.map((b) => {
                    const color = ageColorFromStartDate(b.businessStartDate);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className="m-row"
                        style={{ minHeight: ROW_H }}
                        onClick={() => selectBusiness(b.id)}
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
                  <div className="m-pager">
                    <button
                      type="button"
                      disabled={c.safeListPage <= 1 || c.loading}
                      onClick={() =>
                        c.setListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Prev
                    </button>
                    <span>
                      {c.safeListPage} / {c.listPageCount}
                      <em>
                        {" "}
                        · {c.listStart + 1}–
                        {Math.min(
                          c.listStart + LIST_PAGE_SIZE,
                          c.businesses.length,
                        )}
                      </em>
                    </span>
                    <button
                      type="button"
                      disabled={
                        c.safeListPage >= c.listPageCount || c.loading
                      }
                      onClick={() =>
                        c.setListPage((p) =>
                          Math.min(c.listPageCount, p + 1),
                        )
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
          </div>
        )}
      </section>
    </main>
  );
}
