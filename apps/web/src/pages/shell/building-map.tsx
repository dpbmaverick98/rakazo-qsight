import { useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { divIcon, latLngBounds, map, marker, tileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

/** Read-only enhancement: the adjacent building disclosures remain the navigation fallback. */
export default function BuildingMap({
  buildings,
  onSelect,
}: {
  buildings: Hierarchy["buildings"];
  onSelect: (id: string) => void;
}) {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!container.current || failed) return;
    const located = buildings.filter(
      (building) => building.latitude != null && building.longitude != null,
    );
    if (!located.length) return;
    const view = map(container.current, {
      scrollWheelZoom: false,
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
        const label = document.createElement("span");
        label.textContent = building.name;
        marker(point, {
          icon: divIcon({
            className:
              "rounded-full border-2 border-background bg-primary shadow-sm focus-visible:outline focus-visible:outline-ring",
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          title: building.name,
          alt: building.name,
          keyboard: true,
        })
          .addTo(view)
          .bindTooltip(label)
          .on("click", () => select.current(building.id));
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
      className="relative isolate h-full w-full bg-muted"
    />
  );
}
