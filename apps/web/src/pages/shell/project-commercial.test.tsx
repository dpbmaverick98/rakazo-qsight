// @vitest-environment jsdom

import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CommercialPanel, CommercialSelection } from "./project-commercial";

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
  const back = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <CommercialPanel
          data={commercialFixture}
          loading={false}
          error={false}
          retry={retry}
          back={back}
          {...props}
        />
      </MemoryRouter>,
    ),
  );
  return {
    container,
    retry,
    back,
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
it("supports loading, empty, error/retry and back without write actions", async () => {
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
      await act(async () =>
        [...view.container.querySelectorAll("button")]
          .find((b) => b.textContent === "Back to hierarchy")!
          .click(),
      );
      expect(view.back).toHaveBeenCalledOnce();
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
        <CommercialSelection
          userId="user"
          spaceId={spaceId}
          projectId={projectId}
          client="Example Client"
          back={() => {}}
        />
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

it("shows package activity live and shares one request with the project detail", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn().mockImplementation(async () => Response.json(commercialFixture));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const { ProjectActivity } = await import("./project-commercial");
  const { refreshHierarchy } = await import("./hierarchy-refresh");
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ProjectActivity userId="user" spaceId="space" projectId="roof" />
            <CommercialSelection
              userId="user"
              spaceId="space"
              projectId="roof"
              client="Example"
              back={() => {}}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).toContain("Drywall");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => Response.json({ ...commercialFixture, claims: [] }));
    await act(async () => {
      await refreshHierarchy(client, "user", "space");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).not.toContain("Drywall");
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
