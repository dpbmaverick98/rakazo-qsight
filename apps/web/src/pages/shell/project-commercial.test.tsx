// @vitest-environment jsdom

import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CommercialPanel, useProjectCommercial } from "./project-commercial";

function CommercialSelection({
  userId,
  spaceId,
  projectId,
  revision = 1,
}: {
  userId: string;
  spaceId: string;
  projectId: string;
  revision?: number;
}) {
  const query = useProjectCommercial(userId, spaceId, projectId, revision, "pm");
  return (
    <CommercialPanel
      data={query.isError ? undefined : (query.data ?? undefined)}
      loading={query.isFetching}
      error={query.isError}
      retry={() => {
        void query.refetch();
      }}
    />
  );
}

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
afterEach(() => vi.unstubAllGlobals());
async function mount(props: Partial<ComponentProps<typeof CommercialPanel>> = {}, route = "/app") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const retry = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <CommercialPanel
          data={commercialFixture}
          loading={false}
          error={false}
          retry={retry}
          {...props}
        />
      </MemoryRouter>,
    ),
  );
  return {
    container,
    retry,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it("groups packages behind claim and vendor disclosures and preserves canonical null money", async () => {
  const view = await mount();
  try {
    const claim = [...view.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Finishes",
    )!;
    expect(claim.getAttribute("aria-expanded")).toBe("false");
    await act(async () => claim.click());
    const vendor = [...view.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Example Interiors",
    )!;
    await act(async () => vendor.click());
    expect(view.container.textContent).toContain("Drywall");
    expect(view.container.textContent).toContain("1234.50 USD");
    expect(view.container.querySelectorAll(".sr-only")).toHaveLength(3);
    expect(view.container.textContent).toContain("0 open issues");
    expect(view.container.textContent).toContain("Checks incomplete");
    for (const link of view.container.querySelectorAll("a"))
      expect(link.rel).toBe("noopener noreferrer");
    await act(async () => claim.click());
    expect(claim.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await view.close();
  }
});
it("supports loading, empty, error/retry without write actions", async () => {
  for (const [props, text] of [
    [{ data: undefined, loading: true }, "Loading commercial view…"],
    [{ data: { ...commercialFixture, claims: [] } }, "No active work packages yet"],
    [{ data: undefined, error: true }, "Commercial view unavailable"],
  ] as [Partial<ComponentProps<typeof CommercialPanel>>, string][]) {
    const view = await mount(props);
    try {
      expect(view.container.textContent).toContain(text);
      if (props.error) {
        await act(async () =>
          [...view.container.querySelectorAll("button")]
            .find((b) => b.textContent === "Retry")!
            .click(),
        );
        expect(view.retry).toHaveBeenCalledOnce();
      }
      expect(view.container.querySelectorAll("form,input,textarea")).toHaveLength(0);
    } finally {
      await view.close();
    }
  }
});
it("isolates late responses across project and space changes and clears data on authorization failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish: (value: Response) => void = () => {};
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (spaceId: string, projectId: string) =>
    root.render(
      <QueryClientProvider client={client}>
        <CommercialSelection userId="user" spaceId={spaceId} projectId={projectId} />
      </QueryClientProvider>,
    );
  try {
    await act(async () => render("first", "roof"));
    await act(async () => render("second", "other"));
    await act(async () => {
      finish(Response.json(commercialFixture));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).not.toContain("Roof survey");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("Commercial view unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("refreshes the active project from existing hierarchy signals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn().mockImplementation(async () => Response.json(commercialFixture));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const { refreshHierarchy } = await import("./hierarchy-refresh");
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <CommercialSelection userId="user" spaceId="space" projectId="roof" />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).toContain("Finishes");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => Response.json({ ...commercialFixture, claims: [] }));
    await act(async () => {
      await refreshHierarchy(client, "user", "space");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).not.toContain("Finishes");
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("stops reads after bounded transient retries until an existing refresh signal", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CommercialSelection userId="user" spaceId="space" projectId="roof" />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it("sends the selected revision and never caches a newer binding under an older selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish: (response: Response) => void = () => {};
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    const revision = new Headers(init.headers).get("x-rakazo-binding-revision");
    if (revision === "1")
      return Promise.resolve(Response.json({ status: "binding_stale" }, { status: 409 }));
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (revision: number) =>
    root.render(
      <QueryClientProvider client={client}>
        <CommercialSelection userId="user" spaceId="space" projectId="roof" revision={revision} />
      </QueryClientProvider>,
    );
  try {
    await act(async () => render(2));
    await act(async () => render(1));
    await act(async () => {
      finish(Response.json(commercialFixture));
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Commercial view unavailable"));
    expect(container.textContent).not.toContain("Finishes");
    expect(
      client.getQueryData(["project-commercial", "user", "space", "roof", 1, "pm"]),
    ).toBeUndefined();
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init.headers).get("x-rakazo-binding-revision"),
      ),
    ).toEqual(["2", "1"]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
