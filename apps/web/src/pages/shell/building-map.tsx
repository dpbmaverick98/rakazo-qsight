import { useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { divIcon, latLngBounds, map, marker, tileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

/** Read-only enhancement: the adjacent building disclosures remain the navigation fallback. */
export default function BuildingMap({ buildings }: { buildings: Hierarchy["buildings"] }) {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!container.current || failed) return;
    const located = buildings.filter(
      (building) => building.latitude != null && building.longitude != null,
    );
    if (!located.length) return;
    const view = map(container.current, {
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tapHold: false,
      zoomControl: false,
      attributionControl: true,
    });
    try {
      view.attributionControl.setPrefix(false);
      tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
        .on("tileerror", () => setFailed(true))
        .addTo(view);
      const bounds = latLngBounds([]);
      for (const building of located) {
        const point: [number, number] = [building.latitude!, building.longitude!];
        bounds.extend(point);
        marker(point, {
          icon: divIcon({
            className: "rounded-full border-2 border-background bg-primary shadow-sm",
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          title: building.name,
          alt: building.name,
          keyboard: false,
          interactive: false,
        }).addTo(view);
      }
      view.fitBounds(bounds, { padding: [24, 24], maxZoom: 16, animate: false });
      const resize = new ResizeObserver(() => {
        view.invalidateSize({ pan: false });
        view.fitBounds(bounds, { padding: [24, 24], maxZoom: 16, animate: false });
      });
      resize.observe(container.current);
      return () => {
        resize.disconnect();
        view.remove();
      };
    } catch (error) {
      view.remove();
      throw error;
    }
  }, [buildings, failed]);
  if (failed) throw new Error("Map tiles unavailable");
  return (
    <section
      ref={container}
      aria-label={t`Building map`}
      className="building-map-pastel relative isolate h-full w-full bg-muted"
    />
  );
}
