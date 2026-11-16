// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectStage, useHierarchy } from "./hierarchy-rail";

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
const data = {
  bindingRevision: 1,
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

it("expands only the PM project, reads siblings on demand and keeps Claims scoped", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { commercialFixture } = await import("@rakazo/contracts/project-commercial-fixture");
  const fetch = vi.fn(async (url: string) =>
    Response.json({
      ...commercialFixture,
      project: { ...commercialFixture.project, id: url.includes("sibling") ? "sibling" : "roof" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selectedTab = "space";
  const selection = { botId: "pm", revision: 1, buildingId: "north", projectId: "roof" };
  const stageData = {
    ...data,
    buildings: [
      {
        ...data.buildings[0]!,
        address: "  north building  ",
        latitude: 51.5,
        longitude: -0.1,
        projects: [
          ...data.buildings[0]!.projects,
          { id: "sibling", name: "Other project", url: "https://example.test/sibling" },
        ],
      },
    ],
  };
  const render = (tab: "space" | "claims", current = selection) => (
    <QueryClientProvider client={client}>
      <ProjectStage
        key={current.botId}
        data={stageData}
        loading={false}
        error={false}
        retry={() => {}}
        scope={{ userId: "user", spaceId: "space" }}
        selection={current}
        tab={tab}
        onTabChange={(next) => {
          selectedTab = next;
        }}
      />
    </QueryClientProvider>
  );
  try {
    await act(async () => root.render(render("space")));
    await vi.waitFor(() => expect(container.textContent).toContain("Finishes"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent?.match(/North Building/g)).toHaveLength(1);
    expect(container.querySelector("h2")?.textContent).toBe("Example Client");
    expect(container.querySelector(".lucide-building")).not.toBeNull();
    expect(container.textContent).toContain("Map unavailable");
    expect(container.querySelector(".maplibregl-canvas")).toBeNull();
    expect(container.textContent).not.toContain("OpenStreetMap");
    const sibling = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Other project",
    )!;
    expect(sibling.getAttribute("aria-expanded")).toBe("false");
    await act(async () => sibling.click());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        container.querySelector('a[href="https://hierarchy.example.test/projects/roof"]'),
      ).not.toBeNull(),
    );
    const claim = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Finishes",
    )!;
    await act(async () => claim.click());
    expect(selectedTab).toBe("claims");
    await act(async () => root.render(render("claims")));
    const region = container.querySelector('[aria-label="Commercial"]')!;
    expect(region.textContent).toContain("Roof survey");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("input,form,textarea")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Create|Delete|Upload|Edit|Read-only|Total/);
    await act(async () =>
      root.render(render("claims", { ...selection, botId: "pm-other", projectId: "sibling" })),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
