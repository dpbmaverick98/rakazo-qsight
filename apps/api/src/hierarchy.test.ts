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
