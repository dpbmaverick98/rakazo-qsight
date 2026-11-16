// @vitest-environment jsdom
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientSpaceAction } from "./client-space-action";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
const mocks = vi.hoisted(() => ({ provision: vi.fn(), list: vi.fn() }));
vi.mock("../../lib/rpc", () => ({
  withSpaceHeaders: (headers: HeadersInit, spaceId: string) =>
    new Headers({ ...Object.fromEntries(new Headers(headers)), "x-rakazo-space-id": spaceId }),
  rpcForSpace: () => ({
    bots: { list: mocks.list },
    mcp: { servers: { provisionProjectManager: mocks.provision } },
  }),
}));
const hierarchy: Hierarchy = {
  bindingRevision: 3,
  client: { id: "client", name: "Example Client" },
  buildings: [{ id: "north", name: "North Building", projects: [] }],
};
const project = {
  id: "roof",
  name: "Roof survey",
  building_id: "north",
  currency: "GBP",
  url: "https://example.test/projects/roof",
};
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.list.mockResolvedValue([{ id: "manager" }]);
  mocks.provision.mockResolvedValue({ bot: { id: "manager" }, created: true });
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function mount(
  action: "building" | "project" = "project",
  data: Hierarchy | null = hierarchy,
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated = vi.spyOn(queries, "invalidateQueries");
  const onOpenBot = vi.fn();
  const onClose = vi.fn();
  const refreshRoster = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <QueryClientProvider client={queries}>
        <ClientSpaceAction
          action={action}
          spaceId="space"
          hierarchy={data}
          onOpenBot={onOpenBot}
          onClose={onClose}
          refreshRoster={refreshRoster}
        />
      </QueryClientProvider>,
    ),
  );
  return { onOpenBot, onClose, refreshRoster, invalidated };
}
async function fill(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("validates a project name, creates once, and retries only PM provisioning", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(project));
  vi.stubGlobal("fetch", fetch);
  mocks.provision.mockRejectedValueOnce(new Error("offline"));
  const view = await mount();
  await fill("   ");
  await submit();
  expect(fetch).not.toHaveBeenCalled();
  await fill(" Roof survey ");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  expect(fetch).toHaveBeenCalledOnce();
  const [url, request] = fetch.mock.calls[0]!;
  expect(url).toBe("/api/agent-plane/projects");
  expect(JSON.parse(request.body)).toEqual({ buildingId: "north", name: "Roof survey" });
  expect(new Headers(request.headers).get("x-rakazo-binding-revision")).toBe("3");
  await submit();
  expect(fetch).toHaveBeenCalledOnce();
  expect(mocks.provision).toHaveBeenCalledTimes(2);
  expect(mocks.provision).toHaveBeenLastCalledWith({
    projectId: "roof",
    projectName: "Roof survey",
    clientName: "Example Client",
    bindingRevision: 3,
    finishSetup: true,
  });
  expect(view.onOpenBot).toHaveBeenCalledWith({ id: "manager" });
  expect(view.refreshRoster).toHaveBeenCalledOnce();
  expect(view.invalidated).toHaveBeenCalledWith({ queryKey: ["hierarchy"] });
  expect(view.invalidated).toHaveBeenCalledWith({ queryKey: ["client-navigation"] });
});
it("reuses and reveals an existing project's manager without recreating the project", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.provision.mockResolvedValue({ bot: { id: "existing" }, created: false });
  const view = await mount("project", {
    ...hierarchy,
    buildings: [{ ...hierarchy.buildings[0]!, projects: [project] }],
  });
  await fill("Roof survey");
  await submit();
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({
    projectId: "roof",
    projectName: "Roof survey",
    clientName: "Example Client",
    bindingRevision: 3,
    finishSetup: true,
  });
  expect(view.onOpenBot).toHaveBeenCalledWith({ id: "existing" });
});
it.each(["building", "project"] as const)(
  "uses verified location proof for %s and continues to its manager",
  async (action) => {
    const location = {
      address: "10 Example Street",
      latitude: 51,
      longitude: 0,
      attribution: "Example attribution",
      verification_token: "candidate",
      selectable: true,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: [location], attribution: location.attribution }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...location,
          verification_token: "proof",
          location_precision: "building",
          expires_in: 1800,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "south",
          botId: "manager",
          name: "South Building",
          address: location.address,
          url: "https://example.test/buildings/south",
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...project, building_id: "south" }));
    vi.stubGlobal("fetch", fetch);
    const view = await mount(action);
    if (action === "project") {
      const select = document.querySelector("select")!;
      await act(async () => {
        select.value = "new";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await fill("ab");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await fill("Example Street");
    await submit();
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    await submit();
    await submit();
    if (action === "project") {
      expect(view.onOpenBot).not.toHaveBeenCalled();
      expect(document.querySelector("select")!.value).toBe("south");
      await fill("Roof survey");
      await submit();
      expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({
        buildingId: "south",
        name: "Roof survey",
      });
    }
    expect(fetch.mock.calls.slice(0, 3).map(([url]) => url)).toEqual([
      "/api/agent-plane/locations/search",
      "/api/agent-plane/locations/proof",
      "/api/agent-plane/buildings",
    ]);
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({
      address: location.address,
      verification_token: "proof",
      nickname: "",
    });
    expect(mocks.provision).toHaveBeenCalledTimes(action === "project" ? 1 : 0);
    expect(view.refreshRoster).toHaveBeenCalledOnce();
    expect(view.onOpenBot).toHaveBeenCalledOnce();
  },
);
it("offers a new building from Add project and rejects an unselectable address", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            address: "Broad area",
            latitude: 51,
            longitude: 0,
            attribution: "Example",
            verification_token: "candidate",
            selectable: false,
          },
        ],
        attribution: "Example",
      }),
    ),
  );
  await mount();
  const select = document.querySelector("select")!;
  await act(async () => {
    select.value = "new";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fill("Broad area");
  await submit();
  expect(document.querySelector<HTMLInputElement>('input[type="radio"]')!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(mocks.provision).not.toHaveBeenCalled();
});

it("opens the server-provisioned project manager without provisioning it twice", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...project, botId: "manager" })),
  );
  const view = await mount();
  await fill("Roof survey");
  await submit();
  expect(mocks.provision).not.toHaveBeenCalled();
  expect(view.onOpenBot).toHaveBeenCalledWith({ id: "manager" });
  expect(view.refreshRoster).toHaveBeenCalledOnce();
});
it("opens an empty hierarchy directly in building creation", async () => {
  await mount("project", { ...hierarchy, buildings: [] });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add building");
  expect(document.querySelector('input[minlength="3"]')).not.toBeNull();
});

it("shows a dialog immediately without hierarchy data and offers a retry", async () => {
  await mount("building", null);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add building");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Hierarchy unavailable");
});

it("requires an explicit building choice when there are multiple buildings", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ...project, building_id: "south" }));
  vi.stubGlobal("fetch", fetch);
  await mount("project", {
    ...hierarchy,
    buildings: [...hierarchy.buildings, { id: "south", name: "South", projects: [] }],
  });
  const select = document.querySelector("select")!;
  expect(select.value).toBe("");
  expect(document.querySelector("form")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    select.value = "south";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fill("Roof survey");
  await submit();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).buildingId).toBe("south");
});
it("preselects the only building", async () => {
  await mount();
  expect(document.querySelector("select")!.value).toBe("north");
  expect(document.querySelector("form")).not.toBeNull();
});
