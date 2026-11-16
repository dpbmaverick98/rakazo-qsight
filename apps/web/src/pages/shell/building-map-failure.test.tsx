// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import BuildingMap from "./building-map";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each(["missing key", "missing coordinates", "image error", "ready"])(
  "preserves a static preview and navigation: %s",
  async (scenario) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubEnv("VITE_GEOAPIFY_API_KEY", scenario === "missing key" ? "" : "fake-key&encoded");
    const container = document.createElement("div");
    const root = createRoot(container);
    const building = {
      id: "north",
      name: "North Building",
      latitude: scenario === "missing coordinates" ? null : 0,
      longitude: -0.09,
      projects: [],
    };
    try {
      await act(async () =>
        root.render(
          <>
            <BuildingMap building={building} />
            <span>{building.name}</span>
            <button type="button">Roof survey</button>
          </>,
        ),
      );
      const image = container.querySelector("img");
      if (scenario === "missing key" || scenario === "missing coordinates") {
        expect(image).toBeNull();
      } else {
        const url = new URL(image!.src);
        expect(url.origin + url.pathname).toBe("https://maps.geoapify.com/v1/staticmap");
        expect(Object.fromEntries(url.searchParams)).toEqual({
          style: "positron",
          width: "640",
          height: "320",
          center: "lonlat:-0.09,0",
          zoom: "14",
          marker: "lonlat:-0.09,0",
          apiKey: "fake-key&encoded",
        });
        expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading map…");
        expect(container.querySelector("a")).toBeNull();
        await act(async () =>
          image!.dispatchEvent(new Event(scenario === "ready" ? "load" : "error")),
        );
      }
      if (scenario === "ready") {
        expect(container.querySelector('[role="status"]')).toBeNull();
        expect(Array.from(container.querySelectorAll("a"), (a) => a.href)).toEqual([
          "https://www.geoapify.com/",
          "https://www.openstreetmap.org/copyright",
          "https://openmaptiles.org/",
        ]);
        // Changing buildings must discard the previous image's loaded state.
        await act(async () =>
          root.render(<BuildingMap building={{ ...building, longitude: 1 }} />),
        );
        expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading map…");
      } else {
        expect(container.querySelector('[role="status"]')?.textContent).toBe("Map unavailable");
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent?.match(/North Building/g)).toHaveLength(1);
        expect(container.querySelector("button")?.textContent).toBe("Roof survey");
      }
      expect(container.querySelector("canvas")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  },
);
