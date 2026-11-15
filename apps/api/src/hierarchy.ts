import type { Actor } from "@rakazo/contracts";
import type { CreatedProject, Hierarchy } from "@rakazo/contracts/hierarchy";
import { CreateProjectSchema } from "@rakazo/contracts/hierarchy";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import type { Hono } from "hono";

export function mountHierarchyRoute(
  app: Hono,
  deps: {
    sessionActor: (request: Request) => Promise<Actor | null>;
    trustedOrigin?: (origin: string) => boolean;
    changed?: (actor: Actor) => Promise<void>;
    canCreateProject?: (actor: Actor) => Promise<boolean>;
    spaceClientName: (actor: Actor) => Promise<string | null>;
    source: {
      read: (clientName?: string, fresh?: boolean) => Promise<Hierarchy>;
      createProject?: (buildingId: string, name: string) => Promise<CreatedProject>;
      readCommercial?: (id: string) => Promise<ProjectCommercial>;
    } | null;
  },
) {
  app.post("/api/agent-plane/projects", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!(await deps.canCreateProject?.(actor))) return c.json({ error: "Forbidden" }, 403);
    const origin = c.req.header("origin");
    if (origin && !(deps.trustedOrigin?.(origin) ?? origin === new URL(c.req.url).origin))
      return c.json({ error: "Forbidden" }, 403);
    if (c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json")
      return c.json({ error: "Invalid project request" }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid project request" }, 400);
    }
    const input = CreateProjectSchema.safeParse(body);
    if (!input.success) return c.json({ error: "Invalid project request" }, 400);
    const source = deps.source;
    if (!source?.createProject) return c.json({ error: "Project creation unavailable" }, 503);
    try {
      const name = await deps.spaceClientName(actor);
      if (!name?.trim()) return c.json({ error: "Forbidden" }, 403);
      const hierarchy = await source.read(name, true);
      const building = hierarchy.buildings.find((item) => item.id === input.data.buildingId);
      if (!building) return c.json({ error: "Building unavailable" }, 404);
      if (
        building.projects.some(
          (project) => project.name.toLowerCase() === input.data.name.toLowerCase(),
        )
      )
        return c.json({ error: "Project already exists" }, 409);
      const project = await source.createProject(input.data.buildingId, input.data.name);
      await deps.changed?.(actor);
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "Project already exists")
        return c.json({ error: "Project already exists" }, 409);
      return c.json({ error: "Project creation unavailable" }, 502);
    }
  });
  app.get("/api/agent-plane/projects/:id/commercial", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const source = deps.source;
    if (!source?.readCommercial) return c.body(null, 204);
    const id = c.req.param("id");
    if (!id || id.length > 200 || id === "." || id === ".." || new URL(c.req.url).search)
      return c.json({ error: "Invalid project request" }, 400);
    try {
      const name = await deps.spaceClientName(actor);
      if (name === null) return c.body(null, 204);
      if (!name.trim()) throw new Error("Space name required");
      const hierarchy = await source.read(name, true);
      if (
        !hierarchy.buildings.some((building) =>
          building.projects.some((project) => project.id === id),
        )
      )
        return c.json({ error: "Project unavailable" }, 404);
      return c.json(await source.readCommercial(id));
    } catch {
      return c.json({ error: "Commercial view unavailable" }, 502);
    }
  });
  app.get("/api/agent-plane/hierarchy", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!deps.source) return c.body(null, 204);
    try {
      const name = await deps.spaceClientName(actor);
      if (name === null) return c.body(null, 204);
      if (!name.trim()) throw new Error("Space name required");
      return c.json(await deps.source.read(name, true));
    } catch {
      // Never forward upstream bodies, URLs, headers or credentials.
      return c.json({ error: "Hierarchy unavailable" }, 502);
    }
  });
}
