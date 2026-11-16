import { useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { useState } from "react";

/** Static enhancement; project navigation does not depend on the basemap. */
export default function BuildingMap({ building }: { building: Hierarchy["buildings"][number] }) {
  const { t } = useLingui();
  const key = import.meta.env.VITE_GEOAPIFY_API_KEY;
  const { latitude, longitude } = building;
  const src =
    key && latitude != null && longitude != null
      ? `https://maps.geoapify.com/v1/staticmap?${new URLSearchParams({
          style: "positron",
          width: "640",
          height: "320",
          center: `lonlat:${longitude},${latitude}`,
          zoom: "14",
          marker: `lonlat:${longitude},${latitude}`,
          apiKey: key,
        })}`
      : undefined;
  return <MapImage key={src} src={src} label={t`Building map`} />;
}

function MapImage({ src, label }: { src: string | undefined; label: string }) {
  const { t } = useLingui();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const ready = Boolean(src) && state === "ready";
  return (
    <section
      aria-label={label}
      className="relative mb-4 h-40 overflow-hidden rounded-md border border-border bg-muted"
    >
      {src && state !== "failed" && (
        <img
          src={src}
          alt=""
          width={640}
          height={320}
          draggable={false}
          className={ready ? "h-full w-full object-cover" : "invisible h-full w-full object-cover"}
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
        />
      )}
      {!ready && (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center text-body text-muted-foreground"
        >
          {src && state === "loading" ? t`Loading map…` : t`Map unavailable`}
        </p>
      )}
      {/* Keep accessible credits without duplicating the provider image’s default attribution. */}
      {ready && (
        <div className="sr-only">
          <a tabIndex={-1} href="https://www.geoapify.com/">
            Powered by Geoapify
          </a>{" "}
          |{" "}
          <a tabIndex={-1} href="https://www.openstreetmap.org/copyright">
            © OpenStreetMap contributors
          </a>{" "}
          |{" "}
          <a tabIndex={-1} href="https://openmaptiles.org/">
            © OpenMapTiles
          </a>
        </div>
      )}
    </section>
  );
}
