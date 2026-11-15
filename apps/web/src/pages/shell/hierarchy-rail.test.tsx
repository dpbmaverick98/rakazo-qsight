// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HierarchyRail, useHierarchy } from "./hierarchy-rail";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../lib/rpc", () => ({ withSpaceHeaders: () => new Headers() }));
const data = {
  client: { id: "client", name: "Example Client" },
  buildings: [
    {
      id: "north",
      name: "North Building",
      projects: [
        { id: "roof", name: "Roof survey", url: "https://hierarchy.example.test/projects/roof" },
      ],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
async function mount(props: Partial<ComponentProps<typeof HierarchyRail>> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const retry = vi.fn();
  const collapse = vi.fn();
  await act(async () =>
    root.render(
      <HierarchyRail
        data={data}
        loading={false}
        error={false}
        retry={retry}
        collapse={collapse}
        {...props}
      />,
    ),
  );
  return {
    container,
    retry,
    collapse,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it("expands buildings, offers project selection and collapses the rail", async () => {
  const view = await mount();
  try {
    const button = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("North Building"),
    )!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...view.container.querySelectorAll("button")].some(
        (item) => item.textContent === "Roof survey",
      ),
    ).toBe(true);
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>('[aria-label="Collapse hierarchy"]')!.click(),
    );
    expect(view.collapse).toHaveBeenCalledOnce();
  } finally {
    await view.close();
  }
});
it("renders loading, empty and retryable errors", async () => {
  for (const [props, text] of [
    [{ data: undefined, loading: true }, "Loading hierarchy…"],
    [{ data: { ...data, buildings: [] } }, "No buildings"],
    [{ data: undefined, error: true }, "Hierarchy unavailable"],
  ] as [Partial<ComponentProps<typeof HierarchyRail>>, string][]) {
    const view = await mount(props);
    try {
      expect(view.container.textContent).toContain(text);
      if ("error" in props) {
        await act(async () =>
          [...view.container.querySelectorAll("button")]
            .find((button) => button.textContent === "Retry")!
            .click(),
        );
        expect(view.retry).toHaveBeenCalledOnce();
      }
    } finally {
      await view.close();
    }
  }
});

it("does not display a previous space while a new space loads or is disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let finish: (response: Response) => void = () => {};
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  function Probe({ spaceId }: { spaceId: string }) {
    const query = useHierarchy("user", spaceId, true);
    return <span>{query.data?.client.name ?? "No hierarchy"}</span>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe spaceId="first" />
        </QueryClientProvider>,
      ),
    );
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe spaceId="second" />
        </QueryClientProvider>,
      ),
    );
    await act(async () => finish(Response.json(data)));
    expect(container.textContent).toBe("No hierarchy");
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("hides the map when coordinates are absent or incomplete", async () => {
  const view = await mount({
    data: { ...data, buildings: [{ ...data.buildings[0]!, latitude: 12, longitude: null }] },
  });
  try {
    expect(view.container.querySelector('[aria-label="Building map"]')).toBeNull();
    expect(view.container.textContent).toContain("North Building");
  } finally {
    await view.close();
  }
});

it("pins only complete coordinates and selects, expands and scrolls the building", async () => {
  // Preload the lazy module so this test can observe the real Leaflet marker DOM.
  await import("./building-map");
  const scroll = vi.fn();
  const originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const view = await mount({
    data: {
      ...data,
      buildings: [
        { ...data.buildings[0]!, latitude: 0, longitude: 0 },
        { id: "south", name: "South", latitude: null, longitude: 10, projects: [] },
      ],
    },
  });
  try {
    // React retries the resolved lazy boundary on its next task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const pins = view.container.querySelectorAll<HTMLElement>(".leaflet-marker-icon");
    expect(pins).toHaveLength(1);
    expect(pins[0]!.getAttribute("title")).toBe("North Building");
    expect(pins[0]!.getAttribute("tabindex")).toBe("0");
    await act(async () => pins[0]!.click());
    const button = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("North Building"),
    )!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  } finally {
    await view.close();
    Element.prototype.scrollIntoView = originalScroll;
  }
});
