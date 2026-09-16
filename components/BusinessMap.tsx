"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  CA_BOUNDS_LEAFLET,
  LA_CENTER,
  isInCalifornia,
  normalizeMapBBox,
  type MapBBox,
  type UserLocation,
} from "@/lib/geo";
import { MAP_DEFAULT_ZOOM, MAP_FIND_MIN_ZOOM, MAP_MIN_ZOOM_EXPLORE } from "@/lib/viewLimits";
import type { MapPin } from "@/lib/pins";
import "leaflet/dist/leaflet.css";

export type { UserLocation, MapPin, MapBBox };

const DEFAULT_ZOOM = MAP_DEFAULT_ZOOM;
const LOCATE_ZOOM = 17;
const BOUNDS_DEBOUNCE_MS = 500;

type PinsLayer = {
  setData: (pins: MapPin[], selectedId: string | null) => void;
  destroy: () => void;
};

function strokePin(
  ctx: CanvasRenderingContext2D,
  selected: boolean,
  lineScale: number,
) {
  ctx.lineWidth = (selected ? 2.25 : 1.5) * lineScale;
  ctx.strokeStyle = selected ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.95)";
  ctx.stroke();
}

/** Grow pins as the user zooms in so they stay readable on satellite. */
function pinSizeForZoom(zoom: number): number {
  // ~1 at z14, larger when zoomed in; capped so dense areas stay usable.
  return Math.min(2.6, Math.max(1.15, 1.15 + (zoom - 14) * 0.28));
}

/**
 * Minimal round pin — same silhouette for every rank; color carries meaning.
 * Tip sits at (x, y).
 */
function drawMapPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  _rank: MapPin["rank"],
  selected: boolean,
  zoomScale: number,
) {
  const scale = zoomScale * (selected ? 1.12 : 1);
  const r = 10 * scale;
  const tip = 22 * scale;
  const headY = y - tip + r;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(
    x - r * 0.15,
    y - tip * 0.4,
    x - r,
    headY + r * 0.2,
    x - r,
    headY,
  );
  ctx.arc(x, headY, r, Math.PI, 0, false);
  ctx.bezierCurveTo(
    x + r,
    headY + r * 0.2,
    x + r * 0.15,
    y - tip * 0.4,
    x,
    y,
  );
  ctx.closePath();
  ctx.globalAlpha = selected ? 1 : 0.92;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  strokePin(ctx, selected, scale);

  ctx.beginPath();
  ctx.arc(x, headY, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
}

function isMapUsable(map: L.Map): boolean {
  try {
    const container = map.getContainer();
    if (!container?.isConnected) return false;
    // After map.remove(), panes are gone and fitBounds reads _leaflet_pos on them.
    if (!map.getPane("mapPane")) return false;
    const size = map.getSize();
    return size.x > 1 && size.y > 1;
  } catch {
    return false;
  }
}

function readMapBBox(map: L.Map): MapBBox | null {
  try {
    // Slight pad so edge pins are not clipped from the query.
    const b = map.getBounds().pad(0.03);
    const bbox = normalizeMapBBox({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
    return bbox.north > bbox.south && bbox.east > bbox.west ? bbox : null;
  } catch {
    return null;
  }
}

/** Canvas on the map container — container-point drawing, no pane transform bugs. */
function createPinsLayer(
  map: L.Map,
  onSelect: (id: string | null) => void,
): PinsLayer {
  let pins: MapPin[] = [];
  let selectedId: string | null = null;

  const canvas = document.createElement("canvas");
  canvas.className = "business-pins-canvas";
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:450;";
  map.getContainer().appendChild(canvas);

  function resize() {
    const size = map.getSize();
    if (size.x < 2 || size.y < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.x * dpr);
    canvas.height = Math.round(size.y * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function redraw() {
    if (!isMapUsable(map)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = map.getSize();
    if (size.x < 2 || size.y < 2) return;

    ctx.clearRect(0, 0, size.x, size.y);

    let bounds: L.LatLngBounds;
    let zoom = 14;
    try {
      bounds = map.getBounds().pad(0.05);
      zoom = map.getZoom();
    } catch {
      return;
    }

    const zoomScale = pinSizeForZoom(zoom);
    const pad = 28 * zoomScale;

    // Draw unselected first, selected last (on top).
    let selectedPin: MapPin | null = null;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (!bounds.contains([p.lat, p.lng])) continue;

      const pt = map.latLngToContainerPoint([p.lat, p.lng]);
      if (
        pt.x < -pad ||
        pt.y < -pad * 0.4 ||
        pt.x > size.x + pad ||
        pt.y > size.y + pad
      ) {
        continue;
      }

      if (p.id === selectedId) {
        selectedPin = p;
        continue;
      }
      drawMapPin(ctx, pt.x, pt.y, p.color, p.rank, false, zoomScale);
    }
    if (selectedPin) {
      const pt = map.latLngToContainerPoint([
        selectedPin.lat,
        selectedPin.lng,
      ]);
      drawMapPin(
        ctx,
        pt.x,
        pt.y,
        selectedPin.color,
        selectedPin.rank,
        true,
        zoomScale,
      );
    }
  }

  function onClick(e: L.LeafletMouseEvent) {
    const click = e.containerPoint;
    let zoom = 14;
    try {
      zoom = map.getZoom();
    } catch {
      // ignore
    }
    const zoomScale = pinSizeForZoom(zoom);
    let best: MapPin | null = null;
    let bestDist = 18 * zoomScale;

    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      const pt = map.latLngToContainerPoint([p.lat, p.lng]);
      const selected = p.id === selectedId;
      const scale = zoomScale * (selected ? 1.12 : 1);
      const tipH = 22 * scale;
      const headY = pt.y - tipH + 10 * scale;
      const dHead = Math.hypot(pt.x - click.x, headY - click.y);
      const dTip = Math.hypot(pt.x - click.x, pt.y - click.y);
      const d = Math.min(dHead, dTip);
      if (d <= bestDist) {
        bestDist = d;
        best = p;
      }
    }

    onSelect(best ? best.id : null);
  }

  map.on("move", redraw);
  map.on("zoom", redraw);
  map.on("resize", resize);
  map.on("click", onClick);
  resize();

  return {
    setData(nextPins, nextSelected) {
      pins = Array.isArray(nextPins) ? nextPins : [];
      selectedId = nextSelected;
      redraw();
    },
    destroy() {
      map.off("move", redraw);
      map.off("zoom", redraw);
      map.off("resize", resize);
      map.off("click", onClick);
      canvas.remove();
    },
  };
}

interface BusinessMapProps {
  pins: MapPin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  userLocation: UserLocation | null;
  focusUserToken: number;
  /** Fired (debounced) when the visible map area / zoom changes. */
  onViewChange?: (view: { bbox: MapBBox; zoom: number }) => void;
  /** Fly the camera to a geocoded place (token bumps re-trigger). */
  placeFocus?: { lat: number; lng: number; zoom?: number } | null;
  placeFocusToken?: number;
}

export default function BusinessMap({
  pins,
  selectedId,
  onSelect,
  userLocation,
  focusUserToken,
  onViewChange,
  placeFocus = null,
  placeFocusToken = 0,
}: BusinessMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsLayerRef = useRef<PinsLayer | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  const onViewChangeRef = useRef(onViewChange);
  const pinsRef = useRef(pins);
  const selectedRef = useRef(selectedId);
  const [zoomLabel, setZoomLabel] = useState(() => DEFAULT_ZOOM.toFixed(1));
  onSelectRef.current = onSelect;
  onViewChangeRef.current = onViewChange;
  pinsRef.current = pins;
  selectedRef.current = selectedId;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const caBounds = L.latLngBounds(
      CA_BOUNDS_LEAFLET[0],
      CA_BOUNDS_LEAFLET[1],
    );
    const map = L.map(el, {
      center: LA_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM_EXPLORE,
      maxBounds: caBounds,
      maxBoundsViscosity: 1,
      zoomControl: false,
      preferCanvas: false,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 19,
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 1,
      },
    ).addTo(map);

    // One labels layer, only while zoomed in — street names matter there,
    // and we avoid extra tile traffic when scouting at city/state scale.
    const streetLabels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        opacity: 0.9,
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 0,
      },
    );
    const STREET_LABELS_MIN_ZOOM = 16;

    const syncStreetLabels = () => {
      try {
        const z = map.getZoom();
        const on = map.hasLayer(streetLabels);
        if (z >= STREET_LABELS_MIN_ZOOM) {
          if (!on) streetLabels.addTo(map);
        } else if (on) {
          map.removeLayer(streetLabels);
        }
      } catch {
        // ignore
      }
    };
    map.on("zoomend", syncStreetLabels);
    syncStreetLabels();

    const pinsLayer = createPinsLayer(map, (id) => onSelectRef.current(id));
    const userLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    pinsLayerRef.current = pinsLayer;
    userLayerRef.current = userLayer;

    let cancelled = false;
    let raf2 = 0;
    let boundsTimer = 0;

    const emitBounds = () => {
      if (cancelled || mapRef.current !== map) return;
      if (!isMapUsable(map)) return;
      const bbox = readMapBBox(map);
      if (!bbox) return;
      try {
        onViewChangeRef.current?.({ bbox, zoom: map.getZoom() });
      } catch {
        // ignore
      }
    };

    const scheduleBounds = () => {
      window.clearTimeout(boundsTimer);
      boundsTimer = window.setTimeout(emitBounds, BOUNDS_DEBOUNCE_MS);
    };

    map.on("moveend", scheduleBounds);
    map.on("zoomend", scheduleBounds);

    const syncZoomLabel = () => {
      if (cancelled || mapRef.current !== map) return;
      try {
        setZoomLabel(map.getZoom().toFixed(1));
      } catch {
        // ignore
      }
    };
    map.on("zoom", syncZoomLabel);
    map.on("zoomend", syncZoomLabel);
    syncZoomLabel();

    const sync = () => {
      if (cancelled || mapRef.current !== map) return;
      if (!isMapUsable(map)) return;
      pinsLayer.setData(pinsRef.current, selectedRef.current);
      emitBounds();
      syncZoomLabel();
    };

    // Layout may not be ready on the first frame (absolute / mobile split).
    const raf1 = requestAnimationFrame(() => {
      if (cancelled || mapRef.current !== map) return;
      map.invalidateSize();
      sync();
      raf2 = requestAnimationFrame(() => {
        if (cancelled || mapRef.current !== map) return;
        map.invalidateSize();
        sync();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(boundsTimer);
      map.off("moveend", scheduleBounds);
      map.off("zoomend", scheduleBounds);
      map.off("zoom", syncZoomLabel);
      map.off("zoomend", syncZoomLabel);
      map.off("zoomend", syncStreetLabels);
      pinsLayer.destroy();
      map.remove();
      mapRef.current = null;
      pinsLayerRef.current = null;
      userLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = pinsLayerRef.current;
    if (!map || !layer || !isMapUsable(map)) return;

    // Viewport owns the camera — never fitBounds to results (avoids fetch loops).
    layer.setData(pins, selectedRef.current);
  }, [pins]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = pinsLayerRef.current;
    if (!map || !layer || !isMapUsable(map)) return;

    layer.setData(pinsRef.current, selectedId);
    if (!selectedId) return;

    const hit = pinsRef.current.find((p) => p.id === selectedId);
    if (!hit) return;
    try {
      map.flyTo([hit.lat, hit.lng], Math.max(map.getZoom(), LOCATE_ZOOM), {
        duration: 0.3,
      });
    } catch {
      // ignore
    }
  }, [selectedId]);

  useEffect(() => {
    const userLayer = userLayerRef.current;
    const map = mapRef.current;
    if (!userLayer || !map || !isMapUsable(map)) return;

    userLayer.clearLayers();
    if (
      !userLocation ||
      !isInCalifornia(userLocation.latitude, userLocation.longitude)
    ) {
      return;
    }

    const latlng: L.LatLngExpression = [
      userLocation.latitude,
      userLocation.longitude,
    ];

    if (userLocation.accuracy != null && userLocation.accuracy > 0) {
      L.circle(latlng, {
        radius: Math.min(userLocation.accuracy, 400),
        color: "#2563eb",
        weight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.12,
      }).addTo(userLayer);
    }

    L.circleMarker(latlng, {
      radius: 7,
      color: "#fff",
      weight: 2,
      fillColor: "#2563eb",
      fillOpacity: 1,
    })
      .bindPopup("You are here")
      .addTo(userLayer);
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation || focusUserToken === 0) return;
    if (!isMapUsable(map)) return;
    if (!isInCalifornia(userLocation.latitude, userLocation.longitude)) return;

    try {
      map.flyTo(
        [userLocation.latitude, userLocation.longitude],
        Math.max(map.getZoom(), LOCATE_ZOOM),
        { duration: 0.35 },
      );
    } catch {
      // ignore
    }
  }, [focusUserToken, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placeFocus || placeFocusToken === 0) return;
    if (!isMapUsable(map)) return;
    if (!isInCalifornia(placeFocus.lat, placeFocus.lng)) return;

    try {
      map.flyTo(
        [placeFocus.lat, placeFocus.lng],
        placeFocus.zoom ?? Math.max(map.getZoom(), LOCATE_ZOOM),
        { duration: 0.4 },
      );
    } catch {
      // ignore
    }
  }, [placeFocusToken, placeFocus]);

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="map-canvas-host"
        style={{ height: "100%", width: "100%" }}
        aria-label="Business map"
      />
      <div className="zoom-debug" aria-hidden>
        <span className="zoom-debug-value">{zoomLabel}</span>
        <span className="zoom-debug-meta">
          min {MAP_MIN_ZOOM_EXPLORE} · find ≥{MAP_FIND_MIN_ZOOM} · start {MAP_DEFAULT_ZOOM}
        </span>
      </div>
    </div>
  );
}
