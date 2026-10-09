"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { AGE_COLOR_FILTERS, ageColorFromStartDate } from "@/lib/ageColor";
import { MAP_FIND_MIN_ZOOM } from "@/lib/viewLimits";
import {
  BusinessDetailPanel,
  formatDate,
} from "@/components/BusinessDetailPanel";
import {
  LIST_PAGE_SIZE,
  type BusinessCompassState,
} from "@/hooks/useBusinessCompass";

const BusinessMap = dynamic(() => import("@/components/BusinessMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

type SheetMode = "hidden" | "peek" | "half" | "full";

const SHEET_ORDER: SheetMode[] = ["hidden", "peek", "half", "full"];
const ROW_H = 40;

function stepSheet(current: SheetMode, dir: -1 | 1): SheetMode {
  const index = SHEET_ORDER.indexOf(current);
  const next = Math.min(SHEET_ORDER.length - 1, Math.max(0, index + dir));
  return SHEET_ORDER[next];
}

function dragStartsOnControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, button, a, select"))
  );
}

export default function MobileApp({ c }: { c: BusinessCompassState }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<SheetMode>("peek");
  const [searchOpen, setSearchOpen] = useState(true);
  const [sheetDrag, setSheetDrag] = useState(0);
  const [searchDrag, setSearchDrag] = useState(0);
  const [draggingSheet, setDraggingSheet] = useState(false);
  const [draggingSearch, setDraggingSearch] = useState(false);
  const sheetOrigin = useRef(0);
  const searchOrigin = useRef(0);
  const listOrigin = useRef(0);
  const listSwiped = useRef(false);
  const draggingSheetRef = useRef(false);
  const draggingSearchRef = useRef(false);
  const prevMode = useRef(c.mode);

  useEffect(() => {
    document.documentElement.classList.add("is-phone");
    return () => document.documentElement.classList.remove("is-phone");
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [c.listPage, c.colorFilter, c.mode]);

  useEffect(() => {
    if (c.selectedId) setSheet("full");
  }, [c.selectedId]);

  useEffect(() => {
    if (
      prevMode.current !== "locked" &&
      c.mode === "locked" &&
      !c.loading &&
      !c.selectedId
    ) {
      setSheet((current) =>
        current === "hidden" || current === "peek" ? "half" : current,
      );
    }
    prevMode.current = c.mode;
  }, [c.mode, c.loading, c.selectedId]);

  function selectBusiness(id: string) {
    c.setSelectedId(id);
    setSheet("full");
  }

  function closeDetail() {
    c.closeDetail();
    setSheet(c.mode === "locked" ? "half" : "peek");
  }

  function commitSheet(dy: number) {
    if (Math.abs(dy) < 10) {
      setSheet((current) => {
        if (current === "hidden") return "peek";
        if (current === "full") return "peek";
        return stepSheet(current, 1);
      });
      return;
    }
    if (dy > 96) {
      setSheet("hidden");
      return;
    }
    if (dy > 28) {
      setSheet((current) => stepSheet(current, -1));
      return;
    }
    if (dy < -28) setSheet((current) => stepSheet(current, 1));
  }

  function onSheetPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    sheetOrigin.current = event.clientY;
    draggingSheetRef.current = true;
    setSheetDrag(0);
    setDraggingSheet(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; the gesture still tracks the pointer.
    }
  }

  function onSheetPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingSheetRef.current) return;
    const dy = event.clientY - sheetOrigin.current;
    const clamped = sheet === "full" && dy < 0 ? Math.max(dy, -18) : dy;
    setSheetDrag(clamped);
  }

  function onSheetPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingSheetRef.current) return;
    const dy = event.clientY - sheetOrigin.current;
    draggingSheetRef.current = false;
    setDraggingSheet(false);
    setSheetDrag(0);
    commitSheet(dy);
  }

  function commitSearch(dy: number) {
    if (!searchOpen) {
      if (dy > 24 || Math.abs(dy) < 10) setSearchOpen(true);
      return;
    }
    if (dy < -32) setSearchOpen(false);
  }

  function onSearchPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || dragStartsOnControl(event.target)) return;
    searchOrigin.current = event.clientY;
    draggingSearchRef.current = true;
    setSearchDrag(0);
    setDraggingSearch(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; the gesture still tracks the pointer.
    }
  }

  function onSearchWidgetPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    searchOrigin.current = event.clientY;
    draggingSearchRef.current = true;
    setSearchDrag(0);
    setDraggingSearch(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; the gesture still tracks the pointer.
    }
  }

  function onSearchPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingSearchRef.current) return;
    const dy = event.clientY - searchOrigin.current;
    if (searchOpen) setSearchDrag(Math.min(0, dy));
    else setSearchDrag(Math.max(0, dy));
  }

  function onSearchPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingSearchRef.current) return;
    const dy = event.clientY - searchOrigin.current;
    draggingSearchRef.current = false;
    setDraggingSearch(false);
    setSearchDrag(0);
    commitSearch(dy);
  }

  function onListWidgetPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    listOrigin.current = event.clientY;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; the gesture still tracks the pointer.
    }
  }

  function onListWidgetPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const dy = event.clientY - listOrigin.current;
    if (dy < -20) {
      listSwiped.current = true;
      setSheet(c.selected ? "full" : "half");
    }
  }

  const sheetClass = [
    "m-sheet",
    `is-${sheet}`,
    draggingSheet ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const searchClass = [
    "m-top",
    searchOpen ? "" : "is-away",
    draggingSearch ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sheetStyle =
    draggingSheet && sheetDrag !== 0
      ? { transform: `translateY(${sheetDrag}px)` }
      : undefined;

  const searchStyle =
    draggingSearch && searchDrag !== 0
      ? {
          transform: searchOpen
            ? `translateY(${searchDrag}px)`
            : `translateY(calc(-120% + ${searchDrag}px))`,
        }
      : undefined;

  const listWidgetLabel = c.selected
    ? (c.selected.businessName ?? "Details")
    : c.mode === "explore"
      ? "List"
      : c.loading
        ? "Loading"
        : `${c.pins.length.toLocaleString()}`;

  return (
    <main className="m-app" data-sheet={sheet} data-search={searchOpen ? "open" : "away"}>
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
              <p className="rank-load-copy">Searching this area.</p>
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

        <button
          type="button"
          className="m-locate"
          onClick={c.locateMe}
          disabled={c.geoStatus === "locating"}
          aria-label={c.locateLabel}
          title={c.locateLabel}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path
              fill="currentColor"
              d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
            />
          </svg>
        </button>
      </div>

      <div
        className={searchClass}
        style={searchStyle}
        inert={searchOpen ? undefined : true}
        onPointerDown={onSearchPointerDown}
        onPointerMove={onSearchPointerMove}
        onPointerUp={onSearchPointerUp}
        onPointerCancel={onSearchPointerUp}
      >
        <div className="m-top-grip" aria-hidden>
          <span />
        </div>
        <div className="m-top-stack">
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
                {c.zoomOkForFind ? "Find in view" : `Zoom ≥${MAP_FIND_MIN_ZOOM}`}
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

        {c.placeMessage ? (
          <p
            className={
              c.placeStatus === "ok" ? "m-place-msg" : "m-place-msg is-warn"
            }
            role="status"
          >
            {c.placeMessage}
          </p>
        ) : null}
      </div>

      {searchOpen ? null : (
        <button
          type="button"
          className="m-widget m-widget-search"
        onPointerDown={onSearchWidgetPointerDown}
        onPointerMove={onSearchPointerMove}
        onPointerUp={onSearchPointerUp}
        onPointerCancel={onSearchPointerUp}
      >
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"
            />
          </svg>
          Search
        </button>
      )}

      <section
        className={sheetClass}
        style={sheetStyle}
        inert={sheet === "hidden" ? true : undefined}
        aria-label={c.selected ? "Business details" : "Results"}
      >
        <div
          className="m-sheet-handle"
          role="button"
          tabIndex={sheet === "hidden" ? -1 : 0}
          onPointerDown={onSheetPointerDown}
          onPointerMove={onSheetPointerMove}
          onPointerUp={onSheetPointerUp}
          onPointerCancel={onSheetPointerUp}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commitSheet(0);
            }
          }}
          aria-label={
            sheet === "hidden"
              ? "Show results"
              : sheet === "full"
                ? "Collapse results"
                : "Resize results"
          }
        >
          <span />
          {sheet === "peek" && !c.selected ? (
            <em>{c.statusLabel}</em>
          ) : null}
        </div>

        {c.selected ? (
          <BusinessDetailPanel
            selected={c.selected}
            ageColor={c.ageColor}
            detailLoading={c.detailLoading}
            detailError={c.detailError}
            enrichment={c.enrichment}
            showAdvanced={c.showAdvanced}
            setShowAdvanced={c.setShowAdvanced}
            onClose={closeDetail}
            className="m-detail"
          />
        ) : (
          <div className="m-sheet-body">
            {sheet === "half" || sheet === "full" ? (
              <header className="m-sheet-head">
                <p className="m-status">{c.statusLabel}</p>
                <button
                  type="button"
                  className="m-sheet-collapse"
                  onClick={() => setSheet("hidden")}
                >
                  Hide
                </button>
              </header>
            ) : null}

            <div className="m-filters" role="group" aria-label="Time in business">
              {c.canShowAll ? (
                <button
                  type="button"
                  className={c.colorFilter === "all" ? "m-chip is-active" : "m-chip"}
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

            {sheet === "peek" || sheet === "hidden" ? null : (
              <>
                {c.denseMatchCount != null &&
                c.mode === "locked" &&
                !c.loading ? (
                  <p className="dense-note" role="status">
                    Too many in this rank (
                    {c.denseMatchCount.toLocaleString()}). Zoom in and refresh.
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
                      onClick={() => c.setListPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <span>
                      {c.safeListPage}/{c.listPageCount}
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
          </div>
        )}
      </section>

      {sheet === "hidden" ? (
        <button
          type="button"
          className="m-widget m-widget-list"
          onPointerDown={onListWidgetPointerDown}
          onPointerUp={onListWidgetPointerUp}
          onClick={() => {
            if (listSwiped.current) {
              listSwiped.current = false;
              return;
            }
            setSheet(c.selected ? "full" : "peek");
          }}
        >
          <span className="m-widget-grip" aria-hidden />
          {listWidgetLabel}
        </button>
      ) : null}
    </main>
  );
}
