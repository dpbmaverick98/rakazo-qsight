import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { mountHierarchyRoute } from "./hierarchy.js";

const actor = {
  userId: "user",
  spaceId: "client-space",
  email: "user@example.test",
  isDeploymentOwner: false,
};
const data = { client: { id: "client", name: "Example Client" }, buildings: [] };
it("requires a session and space membership before accessing the source", async () => {
  const read = vi.fn(async () => data);
  const sessionActor = vi.fn(async () => null);
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor,
    source: { read },
    spaceClientName: async () => data.client.name,
  });
  expect((await app.request("/api/agent-plane/hierarchy")).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});
it("hides an unconfigured source and Personal", async () => {
  for (const [sourceSpace, personal] of [
    [null, false],
    [actor.spaceId, true],
  ] as const) {
    const read = vi.fn(async () => data);
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      source: sourceSpace ? { read } : null,
      spaceClientName: async () => (personal ? null : data.client.name),
    });
    const response = await app.request("/api/agent-plane/hierarchy");
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
  }
});
it("returns data and sanitizes upstream failures", async () => {
  const read = vi.fn(async () => data);
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor: async () => actor,
    source: { read },
    spaceClientName: async () => data.client.name,
  });
  expect(await (await app.request("/api/agent-plane/hierarchy")).json()).toEqual(data);
  read.mockRejectedValueOnce(new Error("private upstream details"));
  const failed = await app.request("/api/agent-plane/hierarchy");
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "Hierarchy unavailable" });
});

it("commercial reads authorize the session, bound space and mapped project before fetching", async () => {
  const readCommercial = vi.fn(async () => commercialFixture);
  for (const [session, personal, configured, id, status] of [
    [null, false, true, "roof", 401],
    [actor, true, true, "roof", 204],
    [actor, false, false, "roof", 204],
    [actor, false, true, "unmapped", 404],
    [actor, false, true, "roof/commercial?extra=1", 400],
  ] as const) {
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => session,
      spaceClientName: async () => (personal ? null : data.client.name),
      source: configured
        ? {
            read: async () => data,
            readCommercial,
          }
        : null,
    });
    const response = await app.request(
      `/api/agent-plane/projects/${id.includes("?") ? id : `${id}/commercial`}`,
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(readCommercial).not.toHaveBeenCalled();
});

it("returns mapped commercial data and sanitizes commercial upstream errors", async () => {
  const readCommercial = vi.fn().mockResolvedValue(commercialFixture);
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor: async () => actor,
    spaceClientName: async () => data.client.name,
    source: {
      read: async () => ({
        ...data,
        buildings: [
          {
            id: "b",
            name: "Building",
            projects: [{ id: "roof", name: "Roof", url: "https://example.test/projects/roof" }],
          },
        ],
      }),
      readCommercial,
    },
  });
  expect((await app.request("/api/agent-plane/projects/roof/commercial")).status).toBe(200);
  expect(readCommercial).toHaveBeenCalledWith("roof");
  readCommercial.mockRejectedValueOnce(new Error("private upstream failure"));
  const failed = await app.request("/api/agent-plane/projects/roof/commercial");
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "Commercial view unavailable" });
});

it("resolves two authenticated spaces by their server names for hierarchy and commercial", async () => {
  const names = { "client-space": "Example Client", second: "Second Client" };
  const read = vi.fn(async (name?: string) => ({
    client: { id: name!, name: name! },
    buildings: [
      {
        id: "building",
        name: "Building",
        projects: [
          {
            id: name === "Example Client" ? "roof" : "second-project",
            name: "Project",
            url: "https://example.test",
          },
        ],
      },
    ],
  }));
  const readCommercial = vi.fn(async () => commercialFixture);
  const app = new Hono();
  mountHierarchyRoute(app, {
    sessionActor: async (request) => ({
      ...actor,
      spaceId: request.headers.get("x-rakazo-space-id") ?? actor.spaceId,
    }),
    spaceClientName: async (actor) => names[actor.spaceId as keyof typeof names] ?? null,
    source: { read, readCommercial },
  });
  for (const [spaceId, name] of Object.entries(names)) {
    const response = await app.request("/api/agent-plane/hierarchy", {
      headers: { "x-rakazo-space-id": spaceId },
    });
    expect(await response.json()).toHaveProperty("client.name", name);
    expect(read).toHaveBeenLastCalledWith(name, true);
    const commercial = await app.request("/api/agent-plane/projects/roof/commercial", {
      headers: { "x-rakazo-space-id": spaceId },
    });
    expect(commercial.status).toBe(spaceId === "client-space" ? 200 : 404);
    expect(read).toHaveBeenLastCalledWith(name, true);
  }
  expect(readCommercial).toHaveBeenCalledTimes(1);
});
it("does not use a default client for an empty or mismatched Space name", async () => {
  for (const name of ["", "   ", "Missing Client"]) {
    const read = vi.fn(async () => {
      throw new Error("Hierarchy client mismatch");
    });
    const readCommercial = vi.fn(async () => commercialFixture);
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      spaceClientName: async () => name,
      source: { read, readCommercial },
    });
    for (const path of [
      "/api/agent-plane/hierarchy",
      "/api/agent-plane/projects/roof/commercial",
    ]) {
      expect((await app.request(path)).status).toBe(502);
    }
    if (name.trim())
      expect(read.mock.calls).toEqual([
        [name, true],
        [name, true],
      ]);
    else expect(read).not.toHaveBeenCalled();
    expect(readCommercial).not.toHaveBeenCalled();
  }
});

it("creates only for authorized owners and mapped buildings with valid, unique names", async () => {
  const project = {
    id: "new",
    name: "New",
    currency: "GBP",
    building_id: "b",
    url: "https://example.test/projects/new",
  };
  for (const [session, owner, body, status] of [
    [null, true, { buildingId: "b", name: "New" }, 401],
    [actor, false, { buildingId: "b", name: "New" }, 403],
    [actor, true, { buildingId: "other", name: "New" }, 404],
    [actor, true, { buildingId: "b", name: " " }, 400],
    [actor, true, { buildingId: "b", name: " roof " }, 409],
    [actor, true, { buildingId: "b", name: "New" }, 201],
  ] as const) {
    const createProject = vi.fn(async () => project);
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => session,
      canCreateProject: async () => owner,
      spaceClientName: async () => data.client.name,
      source: {
        read: async () => ({
          ...data,
          buildings: [
            {
              id: "b",
              name: "Building",
              projects: [{ id: "roof", name: "Roof", url: "https://example.test/roof" }],
            },
          ],
        }),
        createProject,
      },
    });
    const response = await app.request("/api/agent-plane/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(status);
    expect(createProject).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
  }
});

it("maps upstream conflicts and sanitizes creation failures", async () => {
  for (const [message, status] of [
    ["Project already exists", 409],
    ["private details", 502],
  ] as const) {
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      canCreateProject: async () => true,
      spaceClientName: async () => data.client.name,
      source: {
        read: async () => ({ ...data, buildings: [{ id: "b", name: "Building", projects: [] }] }),
        createProject: async () => {
          throw new Error(message);
        },
      },
    });
    const response = await app.request("/api/agent-plane/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildingId: "b", name: "New" }),
    });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private");
  }
});

it("rejects missing Space bindings, malformed JSON, non-JSON and foreign-origin writes", async () => {
  for (const [name, body, headers, status] of [
    [null, '{"buildingId":"b","name":"New"}', { "Content-Type": "application/json" }, 403],
    ["Example Client", "{", { "Content-Type": "application/json" }, 400],
    ["Example Client", '{"buildingId":"b","name":"New"}', { "Content-Type": "text/plain" }, 400],
    [
      "Example Client",
      '{"buildingId":"b","name":"New"}',
      { "Content-Type": "application/json", Origin: "https://foreign.example.test" },
      403,
    ],
  ] as const) {
    const createProject = vi.fn();
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      canCreateProject: async () => true,
      spaceClientName: async () => name,
      source: { read: async () => data, createProject },
    });
    expect(
      (await app.request("/api/agent-plane/projects", { method: "POST", headers, body })).status,
    ).toBe(status);
    expect(createProject).not.toHaveBeenCalled();
  }
});
