import type { Actor } from "@rakazo/contracts";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import type { Hono } from "hono";

export function mountHierarchyRoute(
  app: Hono,
  deps: {
    sessionActor: (request: Request) => Promise<Actor | null>;
    isPersonalSpace: (actor: Actor) => Promise<boolean>;
    source: {
      spaceId: string;
      read: () => Promise<Hierarchy>;
      readCommercial?: (id: string) => Promise<ProjectCommercial>;
    } | null;
  },
) {
  app.get("/api/agent-plane/projects/:id/commercial", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const source = deps.source;
    if (
      !source?.readCommercial ||
      actor.spaceId !== source.spaceId ||
      (await deps.isPersonalSpace(actor))
    )
      return c.body(null, 204);
    const id = c.req.param("id");
    if (!id || id.length > 200 || id === "." || id === ".." || new URL(c.req.url).search)
      return c.json({ error: "Invalid project request" }, 400);
    try {
      const hierarchy = await source.read();
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
    if (
      !deps.source ||
      actor.spaceId !== deps.source.spaceId ||
      (await deps.isPersonalSpace(actor))
    )
      return c.body(null, 204);
    try {
      return c.json(await deps.source.read());
    } catch {
      // Never forward upstream bodies, URLs, headers or credentials.
      return c.json({ error: "Hierarchy unavailable" }, 502);
    }
  });
}
