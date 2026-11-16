import { ORPCError } from "@orpc/server";
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { mountHierarchyRoute } from "./hierarchy.js";

const actor = {
  userId: "user",
  spaceId: "space",
  email: "user@example.test",
  isDeploymentOwner: false,
};
const binding = { externalClientId: "client", clientName: "Original", revision: 1 };
const data = {
  client: { id: "client", name: "Renamed upstream" },
  buildings: [
    {
      id: "building",
      name: "Building",
      projects: [{ id: "roof", name: "Roof", url: "https://example.test/roof" }],
    },
  ],
};
function setup() {
  const deps = {
    sessionActor: vi.fn(async () => actor as typeof actor | null),
    resolveBinding: vi.fn(async (_actor: typeof actor, _revision?: number) => binding),
    navigationBots: vi.fn(async () => [
      { id: "manager", spawnKey: "pm:roof" },
      { id: "setup", spawnKey: "setup:client" },
      { id: "foreign", spawnKey: "pm:other-project" },
      { id: "foreign-setup", spawnKey: "setup:other-client" },
      { id: "legacy", spawnKey: null },
    ]),
    canCreateProject: vi.fn(async () => true),
    source: {
      read: vi.fn(async () => data),
      readCommercial: vi.fn(async () => commercialFixture),
      createProject: vi.fn(async () => ({
        id: "new",
        name: "New",
        building_id: "building",
        currency: "GBP",
        url: "https://example.test/new",
      })),
    },
    bindingCommands: {
      status: vi.fn(async () => ({ status: "bound", revision: 1 })),
      change: vi.fn(async () => ({ status: "bound", revision: 1 })),
    },
    changed: vi.fn(async () => {}),
  };
  const app = new Hono();
  mountHierarchyRoute(app, deps);
  return { app, deps };
}
const paths = [
  "/api/agent-plane/hierarchy",
  "/api/agent-plane/projects/roof/commercial",
  "/api/agent-plane/navigation",
];
it("requires a session before reading any external data", async () => {
  const { app, deps } = setup();
  deps.sessionActor.mockResolvedValue(null);
  for (const path of paths) expect((await app.request(path)).status).toBe(401);
  expect(deps.source.read).not.toHaveBeenCalled();
});
it("uses the bound ID despite display names and rechecks revision after reading", async () => {
  const { app, deps } = setup();
  const response = await app.request(paths[0]!);
  expect(await response.json()).toEqual({ ...data, bindingRevision: 1, canManage: true });
  expect(deps.source.read).toHaveBeenCalledWith("client", true);
  expect(deps.resolveBinding).toHaveBeenLastCalledWith(actor, 1);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("reports read-only hierarchy access without enabling construction actions", async () => {
  const { app, deps } = setup();
  deps.canCreateProject.mockResolvedValue(false);
  const response = await app.request(paths[0]!);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ canManage: false, bindingRevision: 1 });
});
it("rejects missing, stale, Personal and forbidden bindings for both read paths", async () => {
  for (const [code, status] of [
    ["binding_missing", 409],
    ["binding_stale", 409],
    ["personal", 409],
    ["forbidden", 403],
  ] as const) {
    const { app, deps } = setup();
    deps.resolveBinding.mockRejectedValue(
      new ORPCError(status === 403 ? "FORBIDDEN" : "CONFLICT", { message: code }),
    );
    for (const path of paths) {
      const response = await app.request(path);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ status: code });
    }
    expect(deps.source.read).not.toHaveBeenCalled();
    expect(deps.source.readCommercial).not.toHaveBeenCalled();
  }
});
it("rejects mismatched upstream clients and removed membership after a read", async () => {
  const { app, deps } = setup();
  deps.source.read.mockResolvedValueOnce({ ...data, client: { id: "wrong", name: "Original" } });
  expect((await app.request(paths[0]!)).status).toBe(502);
  deps.resolveBinding
    .mockResolvedValueOnce(binding)
    .mockRejectedValueOnce(new ORPCError("FORBIDDEN", { message: "forbidden" }));
  expect((await app.request(paths[0]!)).status).toBe(403);
});
it("checks project and building ancestry before commercial reads or writes", async () => {
  const { app, deps } = setup();
  expect((await app.request("/api/agent-plane/projects/other/commercial")).status).toBe(404);
  expect(deps.source.readCommercial).not.toHaveBeenCalled();
  const post = (body: unknown) =>
    app.request("/api/agent-plane/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post({ buildingId: "wrong", name: "New" })).status).toBe(404);
  expect(deps.source.createProject).not.toHaveBeenCalled();
  expect((await post({ buildingId: "building", name: "New" })).status).toBe(201);
  deps.canCreateProject.mockResolvedValue(false);
  expect((await post({ buildingId: "building", name: "New" })).status).toBe(403);
});
it("validates binding command and origin and publishes after success", async () => {
  const { app, deps } = setup();
  for (const [body, status] of [
    [{ revision: 0, externalClientId: "client" }, 200],
    [{ revision: 0, clientName: "forged" }, 400],
    [{ externalClientId: "client" }, 400],
  ] as const) {
    expect(
      (
        await app.request("/api/agent-plane/client-binding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(status);
  }
  expect(deps.changed).toHaveBeenCalledTimes(1);
  expect(
    (
      await app.request("/api/agent-plane/client-binding", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://other.example.test" },
        body: '{"revision":0}',
      })
    ).status,
  ).toBe(403);
});
it("sanitizes upstream failures", async () => {
  const { app, deps } = setup();
  deps.source.read.mockRejectedValue(new Error("private details"));
  const response = await app.request(paths[0]!);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ status: "upstream_unavailable" });
});

it("disabled hierarchy and commercial adapters return explicit safe statuses", async () => {
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor: async () => actor,
    resolveBinding: async () => binding,
    source: null,
  });
  for (const path of paths) {
    const response = await app.request(path);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  }
});
it("passes explicit revisions through all hierarchy and commercial reads", async () => {
  const { app, deps } = setup();
  for (const path of paths) {
    await app.request(path, { headers: { "x-rakazo-binding-revision": "1" } });
    expect(deps.resolveBinding).toHaveBeenCalledWith(actor, 1);
    expect(
      (await app.request(path, { headers: { "x-rakazo-binding-revision": "bad" } })).status,
    ).toBe(400);
  }
});
it("rechecks commercial membership after the external read", async () => {
  const { app, deps } = setup();
  deps.source.readCommercial.mockImplementation(async () => {
    deps.resolveBinding.mockRejectedValue(new ORPCError("FORBIDDEN", { message: "forbidden" }));
    return commercialFixture;
  });
  expect((await app.request(paths[1]!)).status).toBe(403);
});
it("keeps project input and origin checks before upstream writes", async () => {
  const { app, deps } = setup();
  for (const [body, headers, status] of [
    ["{", { "Content-Type": "application/json" }, 400],
    ['{"name":"New"}', { "Content-Type": "application/json" }, 400],
    ['{"buildingId":"","name":"New"}', { "Content-Type": "application/json" }, 400],
    ['{"buildingId":"building","name":"New"}', { "Content-Type": "text/plain" }, 400],
    [
      '{"buildingId":"building","name":"New"}',
      { "Content-Type": "application/json", origin: "https://foreign.example.test" },
      403,
    ],
  ] as const)
    expect(
      (await app.request("/api/agent-plane/projects", { method: "POST", body, headers })).status,
    ).toBe(status);
  expect(deps.source.createProject).not.toHaveBeenCalled();
});

it("validates client setup writes and returns resumable IDs without treating missing MCP as failure", async () => {
  const result = {
    clientId: "client",
    spaceId: "client-space",
    botId: "pm",
    serverId: null,
    status: "mcp_missing" as const,
  };
  const setupClient = vi.fn(async () => result);
  const sessionActor = vi.fn(async () => actor as typeof actor | null);
  const changed = vi.fn(async () => {});
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor,
    setupClient,
    changed,
    source: null,
    resolveBinding: async () => binding,
  });
  const post = (body: unknown, origin?: string) =>
    app.request("/api/agent-plane/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  expect((await post({ name: "Example Client" }, "https://untrusted.test")).status).toBe(403);
  expect((await post({ name: "" })).status).toBe(400);
  expect((await post({ name: "Client", credentials: "ignored" })).status).toBe(400);
  sessionActor.mockResolvedValueOnce(null);
  expect((await post({ name: "Client" })).status).toBe(401);
  expect(setupClient).not.toHaveBeenCalled();
  const response = await post({ name: " Example Client " });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(setupClient).toHaveBeenCalledWith(actor, "Example Client");
  expect(changed).toHaveBeenCalledWith({ ...actor, spaceId: "client-space" });
  setupClient.mockRejectedValueOnce(new ORPCError("CONFLICT", { message: "binding_conflict" }));
  const conflict = await post({ name: "Example Client" });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ status: "binding_conflict" });
});

it("uses only the bound client for confirmed building writes and signals after commit", async () => {
  const { deps } = setup();
  const createBuilding = vi.fn(async () => ({
    id: "site",
    name: "Site",
    address: "10 Example Street",
    url: "https://example.test/buildings/site",
  }));
  const source = { ...deps.source, createBuilding };
  const app = new Hono();
  mountHierarchyRoute(app, { ...deps, source });
  const body = { address: "10 Example Street", verification_token: "fake-proof", nickname: "Site" };
  const post = (data: unknown, headers = {}) =>
    app.request("/api/agent-plane/buildings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-rakazo-binding-revision": "1", ...headers },
      body: JSON.stringify(data),
    });
  expect((await post({ ...body, client_id: "foreign" })).status).toBe(400);
  expect(createBuilding).not.toHaveBeenCalled();
  expect((await post(body)).status).toBe(201);
  expect(createBuilding).toHaveBeenCalledWith("client", body, undefined);
  expect(deps.changed).toHaveBeenCalledWith(actor);
  deps.canCreateProject.mockResolvedValue(false);
  expect((await post(body)).status).toBe(403);
  expect(createBuilding).toHaveBeenCalledTimes(1);
});
it.each(["locations/search", "locations/proof", "buildings"])(
  "guards %s with session, origin, membership and binding checks",
  async (action) => {
    const { deps } = setup();
    const searchLocations = vi.fn();
    const proveLocation = vi.fn();
    const createBuilding = vi.fn();
    const app = new Hono();
    mountHierarchyRoute(app, {
      ...deps,
      source: { ...deps.source, searchLocations, proveLocation, createBuilding },
    });
    const post = (headers = {}) =>
      app.request(`/api/agent-plane/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ query: "Example Street" }),
      });
    deps.sessionActor.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    expect((await post({ origin: "https://foreign.example.test" })).status).toBe(403);
    deps.resolveBinding.mockRejectedValueOnce(
      new ORPCError("CONFLICT", { message: "binding_stale" }),
    );
    expect((await post()).status).toBe(409);
    deps.canCreateProject.mockResolvedValue(false);
    expect((await post()).status).toBe(403);
    expect(searchLocations).not.toHaveBeenCalled();
    expect(proveLocation).not.toHaveBeenCalled();
    expect(createBuilding).not.toHaveBeenCalled();
  },
);
it("allows the upstream receipt to replay a project already visible in the hierarchy", async () => {
  const { app, deps } = setup();
  expect(
    (
      await app.request("/api/agent-plane/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: "building", name: "Roof" }),
      })
    ).status,
  ).toBe(201);
  expect(deps.source.createProject).toHaveBeenCalledWith("building", "Roof", undefined);
});

it("projects only exact canonical assignments and setup for the bound client", async () => {
  const { app, deps } = setup();
  const response = await app.request("/api/agent-plane/navigation");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    spaceId: actor.spaceId,
    bindingRevision: 1,
    client: data.client,
    setupBotIds: ["setup"],
    buildings: [
      {
        id: "building",
        name: "Building",
        botIds: [],
        projects: [{ id: "roof", name: "Roof", botIds: ["manager"] }],
      },
    ],
  });
  expect(deps.navigationBots).toHaveBeenCalledWith(actor);
  expect(deps.resolveBinding).toHaveBeenLastCalledWith(actor, 1);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rechecks membership and revision after navigation bots load", async () => {
  const { app, deps } = setup();
  deps.resolveBinding
    .mockResolvedValueOnce(binding)
    .mockResolvedValueOnce(binding)
    .mockRejectedValueOnce(new ORPCError("FORBIDDEN", { message: "forbidden" }));
  expect((await app.request("/api/agent-plane/navigation")).status).toBe(403);
});
it("navigation never provisions a replacement for an archived manager", async () => {
  const { app, deps } = setup();
  deps.navigationBots.mockResolvedValue([]);
  const response = await app.request("/api/agent-plane/navigation");
  expect((await response.json()).buildings[0].projects[0].botIds).toEqual([]);
  deps.navigationBots.mockResolvedValue([{ id: "manager", spawnKey: "pm:roof" }]);
  const restored = await app.request("/api/agent-plane/navigation");
  expect((await restored.json()).buildings[0].projects[0].botIds).toEqual(["manager"]);
});

it("rejects ambiguous project ancestry instead of duplicating a PM", async () => {
  const { app, deps } = setup();
  deps.source.read.mockResolvedValue({
    ...data,
    buildings: [...data.buildings, { ...data.buildings[0]!, id: "second-building" }],
  });
  expect((await app.request("/api/agent-plane/navigation")).status).toBe(502);
  expect(deps.navigationBots).not.toHaveBeenCalled();
});

it("requests a fresh commercial projection for live hierarchy activity", async () => {
  const { app, deps } = setup();
  expect((await app.request("/api/agent-plane/projects/roof/commercial")).status).toBe(200);
  expect(deps.source.readCommercial).toHaveBeenCalledWith("roof", true);
});

it("provisions the project manager on the server before signaling roster changes", async () => {
  const { deps } = setup();
  const manager = vi.fn(async () => "pm-new");
  const app = new Hono();
  mountHierarchyRoute(app, { ...deps, projectManager: manager });
  const response = await app.request("/api/agent-plane/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({ buildingId: "building", name: "New" }),
  });
  expect(response.status).toBe(201);
  expect((await response.json()).botId).toBe("pm-new");
  expect(manager).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({ id: "new", building_id: "building" }),
    1,
    false,
  );
  expect(manager.mock.invocationCallOrder[0]).toBeLessThan(
    deps.changed.mock.invocationCallOrder[0]!,
  );
});
it("returns the building default agent and retains the operation key for safe retries", async () => {
  const { deps } = setup();
  const building = {
    id: "south",
    name: "South",
    address: "Example Street",
    url: "https://example.test/south",
  };
  const createBuilding = vi.fn(async () => building);
  const manager = vi.fn(async () => "building-manager");
  const app = new Hono();
  mountHierarchyRoute(app, {
    ...deps,
    source: { ...deps.source, createBuilding },
    buildingManager: manager,
  });
  const key = "00000000-0000-4000-8000-000000000001";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request("/api/agent-plane/buildings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        address: building.address,
        verification_token: "fake-proof",
        nickname: "South",
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).botId).toBe("building-manager");
  }
  expect(createBuilding).toHaveBeenLastCalledWith(
    "client",
    expect.objectContaining({ nickname: "South" }),
    key,
  );
  expect(manager).toHaveBeenLastCalledWith(actor, building, 1);
});

it("authorizes project mutations through the current binding and exact confirmation", async () => {
  const { deps } = setup();
  const renameProject = vi.fn(async () => ({}));
  const deleteProject = vi.fn(async () => {});
  const retireProject = vi.fn(async () => {});
  const auditProject = vi.fn(async () => {});
  const app = new Hono();
  mountHierarchyRoute(app, {
    ...deps,
    source: { ...deps.source, renameProject, deleteProject },
    retireProject,
    auditProject,
  });
  const request = (method: string, name: string, id = "roof", origin = "http://localhost") =>
    app.request(`/api/agent-plane/projects/${id}`, {
      method,
      headers: { "content-type": "application/json", origin, "x-rakazo-binding-revision": "1" },
      body: JSON.stringify({ name }),
    });
  deps.sessionActor.mockResolvedValueOnce(null);
  expect((await request("PATCH", "New roof")).status).toBe(401);
  expect((await request("DELETE", "Roof", "roof", "https://foreign.example.test")).status).toBe(
    403,
  );
  deps.canCreateProject.mockResolvedValueOnce(false);
  expect((await request("PATCH", "New roof")).status).toBe(403);
  expect((await request("PATCH", "New roof", "foreign")).status).toBe(404);
  expect((await request("DELETE", "roof")).status).toBe(400);
  expect((await request("DELETE", "Roof ")).status).toBe(400);
  expect(retireProject).not.toHaveBeenCalled();
  expect((await request("PATCH", " New roof ")).status).toBe(204);
  expect(renameProject).toHaveBeenCalledWith("roof", "New roof", "building");
  expect((await request("DELETE", "Roof")).status).toBe(204);
  expect(retireProject).toHaveBeenCalledWith(actor, "roof", 1);
  expect(deleteProject).toHaveBeenCalledWith("roof", "Roof");
  expect(retireProject.mock.invocationCallOrder[0]).toBeLessThan(
    deleteProject.mock.invocationCallOrder[0]!,
  );
  expect(auditProject).toHaveBeenCalledWith(actor, "roof", "delete");
  expect(deps.changed).toHaveBeenCalledTimes(2);
  deps.resolveBinding.mockRejectedValueOnce(
    new ORPCError("CONFLICT", { message: "binding_stale" }),
  );
  expect((await request("DELETE", "Roof")).status).toBe(409);
  expect(deleteProject).toHaveBeenCalledTimes(1);
  retireProject.mockRejectedValueOnce(new Error("revocation unavailable"));
  expect((await request("DELETE", "Roof")).status).toBe(502);
  expect(deleteProject).toHaveBeenCalledTimes(1);
});

it.each([
  [
    { id: "first", spawnKey: "pm:roof" },
    { id: "second", spawnKey: "pm:roof" },
  ],
  [
    { id: "manager", spawnKey: "pm:roof" },
    { id: "manager", spawnKey: "setup:client" },
  ],
])("rejects ambiguous manager assignments without choosing a bot", async (...bots) => {
  const { app, deps } = setup();
  deps.navigationBots.mockResolvedValue(bots);
  const response = await app.request("/api/agent-plane/navigation");
  expect(response.status).toBe(502);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
