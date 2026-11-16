import { useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { Map as LibreMap, LngLatBounds, Marker, setWorkerUrl } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

setWorkerUrl(mapWorkerUrl);

/** Static enhancement; project navigation does not depend on the basemap. */
export default function BuildingMap({ building }: { building: Hierarchy["buildings"][number] }) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const key = import.meta.env.VITE_GEOAPIFY_API_KEY;
  const { latitude, longitude } = building;
  const configured = Boolean(key && latitude != null && longitude != null);
  useEffect(() => {
    if (!host.current || !configured) return;
    let view: LibreMap | undefined;
    let resize: ResizeObserver | undefined;
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;
    setState("loading");
    try {
      view = new LibreMap({
        container: host.current,
        style: `https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=${encodeURIComponent(key ?? "")}`,
        center: [longitude!, latitude!],
        zoom: 14,
        interactive: false,
        attributionControl: false,
      });
      const instance = view;
      const fail = () => setState("failed");
      loadTimeout = setTimeout(fail, 8_000);
      instance.getCanvas().addEventListener("webglcontextlost", fail);
      instance.on("load", () => {
        clearTimeout(loadTimeout);
        try {
          for (const layer of instance.getStyle().layers) {
            if (/poi|transit/i.test(layer.id))
              instance.setLayoutProperty(layer.id, "visibility", "none");
          }
          const pin = document.createElement("div");
          pin.className = "size-4 rounded-full border-2 border-background bg-primary shadow-sm";
          pin.setAttribute("aria-hidden", "true");
          new Marker({ element: pin }).setLngLat([longitude!, latitude!]).addTo(instance);
          const bounds = new LngLatBounds([longitude!, latitude!], [longitude!, latitude!]);
          const fitBuilding = () => {
            instance.resize();
            instance.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
          };
          fitBuilding();
          resize = new ResizeObserver(fitBuilding);
          resize.observe(host.current!);
          setState((previous) => (previous === "failed" ? previous : "ready"));
        } catch {
          fail();
        }
      });
    } catch {
      setState("failed");
    }
    return () => {
      clearTimeout(loadTimeout);
      resize?.disconnect();
      view?.remove();
    };
  }, [configured, key, latitude, longitude]);
  const ready = configured && state === "ready";
  return (
    <section
      aria-label={t`Building map`}
      className="relative mb-4 h-40 overflow-hidden rounded-md border border-border bg-muted"
    >
      <div
        ref={host}
        aria-hidden="true"
        className={ready ? "h-full w-full" : "invisible h-full w-full"}
      />
      {!ready && (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center text-body text-muted-foreground"
        >
          {configured && state === "loading" ? t`Loading map…` : t`Map unavailable`}
        </p>
      )}
      {ready && (
        <div className="absolute bottom-0 right-0 bg-background px-1 text-caption text-foreground">
          <a href="https://www.geoapify.com/">Powered by Geoapify</a> |{" "}
          <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> |{" "}
          <a href="https://openmaptiles.org/">© OpenMapTiles</a>
        </div>
      )}
    </section>
  );
}
