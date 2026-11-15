// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { HierarchyRail, useHierarchy } from "./hierarchy-rail";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../lib/rpc", () => ({
  withSpaceHeaders: () => new Headers(),
  rpcForSpace: () => ({ mcp: { servers: { provisionProjectManager: vi.fn() } } }),
}));
vi.mock("./project-commercial", () => ({
  ProjectActivity: () => null,
  CommercialSelection: () => null,
}));
const data = {
  client: { id: "client", name: "Example Client" },
  buildings: [
    {
      id: "north",
      name: "North Building",
      address: "10 Example Street",
      projects: [
        { id: "roof", name: "Roof survey", url: "https://hierarchy.example.test/projects/roof" },
      ],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
async function mount(props: Partial<ComponentProps<typeof HierarchyRail>> = {}, route = "/app") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const retry = vi.fn();
  const collapse = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <HierarchyRail
          data={data}
          loading={false}
          error={false}
          retry={retry}
          collapse={collapse}
          {...props}
        />
      </MemoryRouter>,
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
it("expands buildings and offers project selection", async () => {
  const view = await mount();
  try {
    const button = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("North Building"),
    )!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent).toContain("10 Example Street");
    expect(view.container.textContent).toContain("Workspace artifacts");
    expect(
      [...view.container.querySelectorAll("button")].some(
        (item) => item.textContent === "Roof survey",
      ),
    ).toBe(true);
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await view.close();
  }
});
it("renders loading, empty and retryable errors", async () => {
  for (const [props, text] of [
    [{ data: undefined, loading: true }, "Loading hierarchy…"],
    [{ data: { ...data, buildings: [] } }, "Quick access to building and project details"],
    [{ data: undefined, error: true }, "Quick access to building and project details"],
  ] as [Partial<ComponentProps<typeof HierarchyRail>>, string][]) {
    const view = await mount(props);
    try {
      expect(view.container.textContent).toContain(text);
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

it("pins only complete coordinates without interactive markers", async () => {
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
    expect(pins[0]!.hasAttribute("tabindex")).toBe(false);
    expect(pins[0]!.classList.contains("leaflet-interactive")).toBe(false);
    await act(async () => pins[0]!.click());
    const button = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("North Building"),
    )!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(scroll).not.toHaveBeenCalled();
  } finally {
    await view.close();
    Element.prototype.scrollIntoView = originalScroll;
  }
});

it("does not offer building setup in the rail", async () => {
  for (const buildings of [data.buildings, []]) {
    const view = await mount({
      data: { ...data, buildings },
      scope: { userId: "user", spaceId: "space" },
    });
    try {
      expect(view.container.textContent).not.toContain("Add building");
      expect(view.container.querySelector('form[aria-label="Add building"]')).toBeNull();
    } finally {
      await view.close();
    }
  }
});

it("keeps the rail read-only with a large client name and a building icon", async () => {
  for (const props of [
    {},
    { data: { ...data, buildings: [] } },
    { data: undefined, loading: true },
  ]) {
    const view = await mount(props);
    try {
      expect(view.container.textContent).not.toMatch(
        /Add project|Add building|Create project manager|Finish setup/,
      );
      expect(view.container.querySelector("form")).toBeNull();
      if (props.data !== undefined || !props.loading)
        expect(view.container.querySelector("h2")?.textContent).toBe("Example Client");
      if (!props.data && !props.loading) {
        expect(view.container.textContent).not.toContain("Building —");
        expect(view.container.querySelector(".lucide-building")).not.toBeNull();
      }
    } finally {
      await view.close();
    }
  }
});

it.each(["personal", "binding_missing", "binding_stale", "binding_conflict", "empty"])(
  "treats a %s Space as empty without losing HTTP errors for other failures",
  async (status) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status }, { status: 409 })));
    const client = new QueryClient();
    const root = createRoot(document.createElement("div"));
    function Probe() {
      useHierarchy("user", "space", true);
      return null;
    }
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        );
      });
      await vi.waitFor(() =>
        expect(client.getQueryState(["hierarchy", "user", "space"])?.status).toBe("success"),
      );
      expect(client.getQueryData(["hierarchy", "user", "space"])).toBeNull();
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  },
);

it("recovers an empty binding on a change signal without timed reads", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: "binding_stale" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(data));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  function Probe() {
    useHierarchy("user", "space", true);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["hierarchy", "user", "space"] });
    });
    expect(client.getQueryData(["hierarchy", "user", "space"])).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it("keeps permission denials as errors", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  function Probe() {
    useHierarchy("user", "space", true);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(client.getQueryState(["hierarchy", "user", "space"])?.status).toBe("error"),
    );
    expect(client.getQueryState(["hierarchy", "user", "space"])?.error).toMatchObject({
      status: 403,
    });
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it.each(["North Building", "  north building  "])(
  "omits a duplicate address %s",
  async (address) => {
    const view = await mount({
      data: { ...data, buildings: [{ ...data.buildings[0]!, address }] },
    });
    try {
      expect(view.container.textContent?.match(/North Building/g)).toHaveLength(1);
      expect(view.container.querySelector("p")).toBeNull();
    } finally {
      await view.close();
    }
  },
);
