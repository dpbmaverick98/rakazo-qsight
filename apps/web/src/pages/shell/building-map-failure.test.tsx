// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import BuildingMap from "./building-map";

const mocks = vi.hoisted(() => ({
  map: vi.fn(),
  tileLayer: vi.fn(),
  latLngBounds: vi.fn(),
  marker: vi.fn(),
}));
vi.mock("leaflet", () => ({ ...mocks, divIcon: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: () => "Building map" }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => vi.restoreAllMocks());
it.each(["initialization", "tiles"])(
  "preserves the building list after map %s failure",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const remove = vi.fn();
    mocks.map.mockImplementation(() => {
      if (failure === "initialization") throw new Error("Map unavailable");
      return { attributionControl: { setPrefix: vi.fn() }, remove, fitBounds: vi.fn() };
    });
    let tileFailed = () => {};
    const layer = {
      on: (_event: string, failed: () => void) => {
        tileFailed = failed;
        return layer;
      },
      addTo: vi.fn(),
    };
    mocks.tileLayer.mockReturnValue(layer);
    mocks.latLngBounds.mockReturnValue({ extend: vi.fn() });
    const pin = { addTo: () => pin, bindTooltip: () => pin, on: () => pin };
    mocks.marker.mockReturnValue(pin);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    i18n.loadAndActivate({ locale: "en", messages: {} });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <I18nProvider i18n={i18n}>
            <ErrorBoundary fallback={null}>
              <BuildingMap
                buildings={[
                  { id: "north", name: "North Building", latitude: 0, longitude: 0, projects: [] },
                ]}
              />
            </ErrorBoundary>
            <button type="button">North Building</button>
          </I18nProvider>,
        ),
      );
      if (failure === "tiles") {
        expect(mocks.map).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            touchZoom: false,
            tapHold: false,
            zoomControl: false,
            attributionControl: true,
          }),
        );
        expect(mocks.marker).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            keyboard: false,
            interactive: false,
          }),
        );
        expect(
          container
            .querySelector('[aria-label="Building map"]')
            ?.classList.contains("building-map-pastel"),
        ).toBe(true);
        expect(mocks.tileLayer).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ attribution: expect.stringContaining("OpenStreetMap") }),
        );
        await act(async () => tileFailed());
      }
      expect(container.querySelector('[aria-label="Building map"]')).toBeNull();
      expect(container.querySelector("button")?.textContent).toBe("North Building");
      if (failure === "tiles") expect(remove).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
