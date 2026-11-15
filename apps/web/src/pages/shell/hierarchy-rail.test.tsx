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
it("expands buildings, offers project selection and collapses the rail", async () => {
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
    [{ data: { ...data, buildings: [] } }, "Quick access to building and project details"],
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

it("opens building setup without a chat handoff", async () => {
  const view = await mount({ scope: { userId: "user", spaceId: "space" } });
  try {
    const button = [...view.container.querySelectorAll("button")].find(
      (item) => item.textContent === "Add building",
    )!;
    await act(async () => button.click());
    expect(view.container.querySelector('form[aria-label="Add building"]')).not.toBeNull();
  } finally {
    await view.close();
  }
});

it("submits in the rail, retains errors and refreshes after success without a chat handoff", async () => {
  const project = {
    id: "new",
    name: "New",
    currency: "GBP",
    building_id: "north",
    url: "https://example.test/projects/new",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(Response.json(project));
  vi.stubGlobal("fetch", fetch);
  const view = await mount({ scope: { userId: "user", spaceId: "space" } });
  try {
    const click = async (name: string) =>
      act(async () =>
        [...view.container.querySelectorAll("button")]
          .find((button) => button.textContent === name)!
          .click(),
      );
    await click("Add project");
    const form = view.container.querySelector("form")!;
    const input = form.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        " New ",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (const message of [
      "Project already exists",
      "Could not complete project setup. Try again.",
      null,
    ]) {
      await act(async () =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      if (message) {
        expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(message);
        expect(input.value).toBe(" New ");
        expect(view.retry).not.toHaveBeenCalled();
      }
    }
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ buildingId: "north", name: "New" }),
    });
    expect(view.retry).toHaveBeenCalledOnce();
    expect(view.container.querySelector("form")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Add project");
  } finally {
    await view.close();
  }
});

it("requires a selectable candidate and canonical confirmation, and retains the proof on retry", async () => {
  const candidate = {
    address: "10 Example Street",
    latitude: 1,
    longitude: 2,
    attribution: "Map attribution",
    selectable: true,
    verification_token: "fake-candidate",
  };
  const proof = {
    ...candidate,
    verification_token: "fake-proof",
    location_precision: "building",
    expires_in: 1800,
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        items: [{ ...candidate, address: "Example town", selectable: false }, candidate],
        attribution: "Map attribution",
      }),
    )
    .mockResolvedValueOnce(Response.json(proof))
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(
      Response.json({
        id: "new",
        name: "",
        address: candidate.address,
        url: "https://example.test/buildings/new",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const view = await mount({ scope: { userId: "user", spaceId: "space" } });
  try {
    const click = async (text: string) =>
      act(async () =>
        [...view.container.querySelectorAll("button")]
          .find((button) => button.textContent === text)!
          .click(),
      );
    await click("Add building");
    const form = view.container.querySelector('form[aria-label="Add building"]')!;
    const input = form.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Example Street",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Search");
    const radios = form.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios[0]!.disabled).toBe(true);
    expect(
      [...form.querySelectorAll("button")].find((button) => button.textContent === "Use location")!
        .disabled,
    ).toBe(true);
    await act(async () => radios[1]!.click());
    await click("Use location");
    expect(fetch.mock.calls[1]![1].body).toBe(
      JSON.stringify({ verification_token: "fake-candidate" }),
    );
    expect(form.textContent).toContain("10 Example Street");
    expect(fetch).toHaveBeenCalledTimes(2);
    await click("Confirm building");
    expect(form.querySelector('[role="alert"]')).not.toBeNull();
    await click("Confirm building");
    expect(fetch.mock.calls[2]![1].body).toBe(fetch.mock.calls[3]![1].body);
    expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({
      address: "10 Example Street",
      verification_token: "fake-proof",
      nickname: "",
    });
    expect(view.retry).toHaveBeenCalledOnce();
    expect(view.container.querySelector('form[aria-label="Add building"]')).toBeNull();
  } finally {
    await view.close();
  }
});

it("recovers from temporary session/proxy errors and empty responses, then stops fallback reads", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ ...data, buildings: [] }))
    .mockResolvedValue(Response.json(data));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    const query = useHierarchy("user", "space", true);
    return <span>{query.data?.buildings[0]?.name ?? "Empty"}</span>;
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
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(container.textContent).toBe("Empty");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_010);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_010);
    });
    expect(container.textContent).toBe("North Building");
    const count = fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetch).toHaveBeenCalledTimes(count);
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it.each(["personal", "binding_missing"])(
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
