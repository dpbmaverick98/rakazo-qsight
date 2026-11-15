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
const paths = ["/api/agent-plane/hierarchy", "/api/agent-plane/projects/roof/commercial"];
it("requires a session before reading any external data", async () => {
  const { app, deps } = setup();
  deps.sessionActor.mockResolvedValue(null);
  for (const path of paths) expect((await app.request(path)).status).toBe(401);
  expect(deps.source.read).not.toHaveBeenCalled();
});
it("uses the bound ID despite display names and rechecks revision after reading", async () => {
  const { app, deps } = setup();
  const response = await app.request(paths[0]!);
  expect(await response.json()).toEqual(data);
  expect(deps.source.read).toHaveBeenCalledWith("client", true);
  expect(deps.resolveBinding).toHaveBeenLastCalledWith(actor, 1);
  expect(response.headers.get("cache-control")).toBe("no-store");
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
it("keeps project input/origin checks and duplicate guards before upstream writes", async () => {
  const { app, deps } = setup();
  for (const [body, headers, status] of [
    ["{", { "Content-Type": "application/json" }, 400],
    ['{"buildingId":"building","name":"New"}', { "Content-Type": "text/plain" }, 400],
    [
      '{"buildingId":"building","name":"New"}',
      { "Content-Type": "application/json", origin: "https://foreign.example.test" },
      403,
    ],
    ['{"buildingId":"building","name":" roof "}', { "Content-Type": "application/json" }, 409],
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
