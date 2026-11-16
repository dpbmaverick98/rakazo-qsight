// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import BuildingMap from "./building-map";

const mocks = vi.hoisted(() => ({ Map: vi.fn(), Marker: vi.fn(), LngLatBounds: vi.fn() }));
vi.mock("maplibre-gl", () => ({ ...mocks, setWorkerUrl: vi.fn() }));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "worker.js" }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each([
  "missing key",
  "WebGL",
  "style",
  "context loss",
  "ready",
  "post-load error",
  "post-load context loss",
])("preserves navigation: %s", async (scenario) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_GEOAPIFY_API_KEY", scenario === "missing key" ? "" : "fake-key");
  const events: Record<string, () => void> = {};
  const canvas = document.createElement("canvas");
  const view = {
    on: vi.fn((event: string, callback: () => void) => {
      events[event] = callback;
    }),
    getCanvas: () => canvas,
    getStyle: () => ({ layers: [{ id: "poi-label" }, { id: "transit-stop" }, { id: "road" }] }),
    setLayoutProperty: vi.fn(),
    resize: vi.fn(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
  };
  mocks.Map.mockImplementation(function MapConstructor() {
    if (scenario === "WebGL") throw new Error("No WebGL");
    return view;
  });
  const pin = { setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis() };
  mocks.Marker.mockImplementation(function MarkerConstructor() {
    return pin;
  });
  mocks.LngLatBounds.mockImplementation(function BoundsConstructor() {
    return {};
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          <BuildingMap
            building={{
              id: "north",
              name: "North Building",
              latitude: 0,
              longitude: 0,
              projects: [],
            }}
          />
          <button type="button">Roof survey</button>
        </>,
      ),
    );
    if (scenario === "missing key") expect(mocks.Map).not.toHaveBeenCalled();
    else
      expect(mocks.Map).toHaveBeenCalledWith(
        expect.objectContaining({
          interactive: false,
          attributionControl: false,
          zoom: 14,
          style: "https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=fake-key",
        }),
      );
    if (scenario === "style") await act(async () => events.error!());
    if (scenario === "context loss")
      await act(async () => canvas.dispatchEvent(new Event("webglcontextlost")));
    if (["ready", "post-load error", "post-load context loss"].includes(scenario)) {
      await act(async () => events.load!());
      expect(view.setLayoutProperty.mock.calls).toEqual([
        ["poi-label", "visibility", "none"],
        ["transit-stop", "visibility", "none"],
      ]);
      expect(mocks.Marker).toHaveBeenCalledOnce();
      expect(pin.setLngLat).toHaveBeenCalledWith([0, 0]);
      expect(view.fitBounds).toHaveBeenCalledWith(expect.anything(), {
        padding: 24,
        maxZoom: 14,
        duration: 0,
      });
      expect(container.textContent).toContain("Geoapify");
      expect(container.textContent).not.toContain("North Building");
      if (scenario === "post-load error") {
        await act(async () => events.error!());
        await act(async () => events.error!());
      }
      if (scenario === "post-load context loss") {
        await act(async () => canvas.dispatchEvent(new Event("webglcontextlost")));
        expect(container.querySelector('[role="status"]')?.textContent).toBe("Map unavailable");
        expect(container.querySelector('a[href="https://www.geoapify.com/"]')).toBeNull();
      } else {
        expect(container.querySelector('[role="status"]')).toBeNull();
        expect(container.querySelector('[aria-hidden="true"]')?.className).toBe("h-full w-full");
        expect(container.querySelector('a[href="https://www.geoapify.com/"]')).not.toBeNull();
        expect(pin.addTo).toHaveBeenCalledWith(view);
      }
    } else expect(container.querySelector('[role="status"]')?.textContent).toBe("Map unavailable");
    expect(container.querySelector("button")?.textContent).toBe("Roof survey");
  } finally {
    await act(async () => root.unmount());
  }
  if (!["missing key", "WebGL"].includes(scenario)) expect(view.remove).toHaveBeenCalledOnce();
});
