// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectStage, projectStageFailure, useHierarchy } from "./hierarchy-rail";

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

it.each([
  [403, undefined, "forbidden"],
  [409, "binding_stale", "stale"],
  [409, "binding_conflict", "stale"],
  [409, "space_unavailable", "stale"],
])("keeps HTTP %s (%s) as a %s error", async (status, bodyStatus, reason) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ status: bodyStatus }, { status })),
  );
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
      status,
      reason,
    });
    expect(client.getQueryData(["hierarchy", "user", "space"])).toBeUndefined();
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
        address: "10 Example Street",
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
    expect(container.textContent?.match(/10 Example Street/g)).toHaveLength(1);
    expect(container.querySelector("h2")?.textContent).toBe("Example Client");
    expect(container.querySelector(".lucide-building")).not.toBeNull();
    expect(container.textContent).toContain("Map unavailable");
    const identity = container.querySelector(".lucide-building")!.parentElement!;
    expect(
      container.querySelector('[role="status"]')!.compareDocumentPosition(identity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector(".maplibregl-canvas")).toBeNull();
    expect(container.textContent).not.toContain("OpenStreetMap");
    const sibling = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Other project",
    )!;
    expect(sibling.getAttribute("aria-expanded")).toBe("false");
    await act(async () => sibling.click());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.querySelectorAll("li span.text-body")).toHaveLength(1));
    expect(container.querySelector("li span.text-body")?.textContent).toBe("Finishes");
    expect(container.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Open project|Open work package|Open record/);
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

it.each([
  [" north BUILDING ", false],
  ["10 Example Street", true],
  ["", false],
  ["   ", false],
])(
  "shows building identity without a duplicate or empty address (%j)",
  async (address, showAddress) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <ProjectStage
              data={{ ...data, buildings: [{ ...data.buildings[0]!, address }] }}
              loading={false}
              retry={() => {}}
              scope={{ userId: "user", spaceId: "space" }}
              selection={{ botId: "pm", revision: 1, buildingId: "north", projectId: "roof" }}
              tab="space"
              onTabChange={() => {}}
            />
          </QueryClientProvider>,
        ),
      );
      expect(container.textContent?.match(/North Building/g)).toHaveLength(1);
      const identity = container.querySelector(".lucide-building")!.parentElement!;
      expect(identity.textContent).toBe(`North Building${showAddress ? address : ""}`);
      expect(identity.querySelectorAll(".text-muted-foreground")).toHaveLength(showAddress ? 1 : 0);
      if (showAddress) expect(container.textContent?.split(address)).toHaveLength(2);
      expect(
        identity.compareDocumentPosition(container.querySelector("ul")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  },
);

it("maps project stage failures in priority order", () => {
  const ready = { loading: false, selected: true };
  expect(projectStageFailure({ ...ready, navigationError: true, error: { reason: "stale" } })).toBe(
    "navigation",
  );
  for (const reason of [
    "navigation",
    "stale",
    "forbidden",
    "unauthorized",
    "unavailable",
    "selection",
  ] as const)
    expect(projectStageFailure({ ...ready, error: { reason, status: 401 } })).toBe(reason);
  for (const [status, expected] of [
    [401, "unauthorized"],
    [403, "forbidden"],
    [500, "unavailable"],
    ["401", "unavailable"],
  ] as const)
    expect(projectStageFailure({ ...ready, error: { status } })).toBe(expected);
  expect(projectStageFailure({ ...ready, error: new Error("Failed") })).toBe("unavailable");
  expect(projectStageFailure({ loading: false, selected: undefined })).toBe("selection");
  expect(projectStageFailure({ ...ready, error: { status: 401 } })).toBe("unauthorized");
  expect(projectStageFailure({ ...ready, error: { status: 403 } })).toBe("forbidden");
  expect(projectStageFailure({ ...ready, error: { status: 503 } })).toBe("unavailable");
  expect(projectStageFailure({ ...ready, error: { status: "401" } })).toBe("unavailable");
  expect(projectStageFailure({ ...ready, error: new Error("Network failed") })).toBe("unavailable");
  expect(projectStageFailure({ loading: true, selected: undefined })).toBeUndefined();
  expect(projectStageFailure(ready)).toBeUndefined();
});

it("shows a stale connection warning, clears inspection and offers Retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { inspectionStorageKey } = await import("./commercial-inspection");
  const key = inspectionStorageKey(JSON.stringify(["user", "space", "pm", 1, "roof"]));
  sessionStorage.setItem(key, "saved");
  const container = document.createElement("div");
  const root = createRoot(container);
  const retry = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ProjectStage
          data={data}
          loading={false}
          failure="stale"
          retry={retry}
          scope={{ userId: "user", spaceId: "space" }}
          selection={{ botId: "pm", revision: 1, buildingId: "north", projectId: "roof" }}
          tab="space"
          onTabChange={() => {}}
        />,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This project's client connection has changed.",
    );
    expect(sessionStorage.getItem(key)).toBeNull();
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Retry",
    )!;
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    sessionStorage.removeItem(key);
  }
});
