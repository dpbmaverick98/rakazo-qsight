import type { Actor } from "@rakazo/contracts";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import type { Hono } from "hono";

export function mountHierarchyRoute(
  app: Hono,
  deps: {
    sessionActor: (request: Request) => Promise<Actor | null>;
    isPersonalSpace: (actor: Actor) => Promise<boolean>;
    source: { spaceId: string; read: () => Promise<Hierarchy> } | null;
  },
) {
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
