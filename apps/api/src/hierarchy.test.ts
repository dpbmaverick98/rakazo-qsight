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
    source: { spaceId: actor.spaceId, read },
    isPersonalSpace: async () => false,
  });
  expect((await app.request("/api/agent-plane/hierarchy")).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});
it("hides an unconfigured source, other spaces and Personal", async () => {
  for (const [sourceSpace, personal] of [
    [null, false],
    ["other", false],
    [actor.spaceId, true],
  ] as const) {
    const read = vi.fn(async () => data);
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      source: sourceSpace ? { spaceId: sourceSpace, read } : null,
      isPersonalSpace: async () => personal,
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
    source: { spaceId: actor.spaceId, read },
    isPersonalSpace: async () => false,
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
    [{ ...actor, spaceId: "other" }, false, true, "roof", 204],
    [actor, true, true, "roof", 204],
    [actor, false, false, "roof", 204],
    [actor, false, true, "unmapped", 404],
    [actor, false, true, "roof/commercial?extra=1", 400],
  ] as const) {
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => session,
      isPersonalSpace: async () => personal,
      source: configured
        ? {
            spaceId: actor.spaceId,
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
    isPersonalSpace: async () => false,
    source: {
      spaceId: actor.spaceId,
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
