import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type {
  ClientSetup,
  CreateBuilding,
  CreatedBuilding,
  CreatedProject,
  Hierarchy,
  LocationCandidates,
  LocationProof,
} from "@rakazo/contracts/hierarchy";
import {
  ChangeClientBindingSchema,
  CreateBuildingSchema,
  CreateClientSchema,
  CreateProjectSchema,
  HierarchyOperationIdSchema,
  LocationProofInputSchema,
  LocationQuerySchema,
  ProjectMutationSchema,
  RenameProjectSchema,
} from "@rakazo/contracts/hierarchy";
import type {
  CommercialInspectionSelection,
  ProjectCommercial,
} from "@rakazo/contracts/project-commercial";
import { CommercialInspectionSelectionSchema } from "@rakazo/contracts/project-commercial";
import type { Hono } from "hono";
import type { ClientBinding } from "./space-client-binding.js";

export function mountHierarchyRoute(
  app: Hono,
  deps: {
    sessionActor: (request: Request) => Promise<Actor | null>;
    authorizePreview?: (
      actor: Actor,
      botId: string,
      selection: CommercialInspectionSelection,
    ) => Promise<void>;
    trustedOrigin?: (origin: string) => boolean;
    changed?: (actor: Actor) => Promise<void>;
    canCreateProject?: (actor: Actor) => Promise<boolean>;
    buildingManager?: (
      actor: Actor,
      building: CreatedBuilding,
      revision: number,
    ) => Promise<string>;
    projectManager?: (
      actor: Actor,
      project: Pick<CreatedProject, "id" | "name">,
      revision: number,
      finishSetup: boolean,
      automatic?: boolean,
    ) => Promise<string>;
    retireProject?: (actor: Actor, projectId: string, revision: number) => Promise<void>;
    auditProject?: (actor: Actor, projectId: string, action: "rename" | "delete") => Promise<void>;
    navigationBots?: (actor: Actor) => Promise<{ id: string; spawnKey: string | null }[]>;
    resolveBinding: (actor: Actor, revision?: number) => Promise<ClientBinding>;
    setupClient?: (actor: Actor, name: string) => Promise<ClientSetup>;
    bindingCommands?: {
      status: (actor: Actor) => Promise<unknown>;
      change: (
        actor: Actor,
        input: { revision: number; externalClientId?: string },
      ) => Promise<unknown>;
    };
    source: {
      searchLocations?: (query: string) => Promise<LocationCandidates>;
      proveLocation?: (token: string) => Promise<LocationProof>;
      createBuilding?: (
        clientId: string,
        data: CreateBuilding,
        operationId?: string,
      ) => Promise<CreatedBuilding>;
      read: (externalClientId: string, fresh?: boolean) => Promise<Hierarchy>;
      createProject?: (
        buildingId: string,
        name: string,
        operationId?: string,
      ) => Promise<CreatedProject>;
      renameProject?: (id: string, name: string, buildingId: string) => Promise<unknown>;
      deleteProject?: (id: string, name: string) => Promise<void>;
      previewDocument?: (id: string) => Promise<Response>;
      readCommercial?: (id: string, fresh?: boolean) => Promise<ProjectCommercial>;
    } | null;
  },
) {
  const failure = (error: unknown) => {
    if (error instanceof ORPCError)
      return {
        status: error.status as 400 | 403 | 409 | 502 | 503,
        body: { status: error.message },
      };
    return { status: 502 as const, body: { status: "upstream_unavailable" } };
  };
  const read = async (actor: Actor, revision?: number) => {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new ORPCError("BAD_REQUEST", { message: "invalid_request" });
    if (!deps.source) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "disabled" });
    const binding = await deps.resolveBinding(actor, revision);
    const hierarchy = await deps.source.read(binding.externalClientId, true);
    if (hierarchy.client.id !== binding.externalClientId)
      throw new ORPCError("BAD_GATEWAY", { message: "binding_mismatch" });
    await deps.resolveBinding(actor, binding.revision);
    return { hierarchy, binding };
  };
  // Reconcile external tool-created projects as well as projects created through this API.
  const finishSingleProject = async (
    actor: Actor,
    hierarchy: Hierarchy,
    binding: ClientBinding,
  ) => {
    const projects = hierarchy.buildings.flatMap((building) => building.projects);
    if (projects.length !== 1 || !deps.projectManager || !(await deps.canCreateProject?.(actor)))
      return;
    const bots = await deps.navigationBots?.(actor);
    if (
      !bots?.some((bot) => bot.spawnKey === `setup:${binding.externalClientId}`) ||
      bots.some((bot) => bot.spawnKey === `pm:${projects[0]!.id}`)
    )
      return;
    await deps.projectManager(actor, projects[0]!, binding.revision, true, true);
    await deps.changed?.(actor);
  };
  app.post("/api/agent-plane/clients", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ status: "unauthorized" }, 401);
    const origin = c.req.header("origin");
    if (origin && !(deps.trustedOrigin?.(origin) ?? origin === new URL(c.req.url).origin))
      return c.json({ status: "forbidden" }, 403);
    if (c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json")
      return c.json({ status: "invalid_request" }, 400);
    try {
      const input = CreateClientSchema.safeParse(await c.req.json());
      if (!input.success) return c.json({ status: "invalid_request" }, 400);
      if (!deps.setupClient) return c.json({ status: "disabled" }, 503);
      const result = await deps.setupClient(actor, input.data.name);
      await deps.changed?.({ ...actor, spaceId: result.spaceId });
      return c.json(result);
    } catch (error) {
      if (error instanceof SyntaxError) return c.json({ status: "invalid_request" }, 400);
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  app.get("/api/agent-plane/client-binding", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ status: "unauthorized" }, 401);
    try {
      if (!deps.bindingCommands) return c.json({ status: "disabled" }, 503);
      return c.json(await deps.bindingCommands.status(actor));
    } catch (error) {
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  app.post("/api/agent-plane/client-binding", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ status: "unauthorized" }, 401);
    const origin = c.req.header("origin");
    if (origin && !(deps.trustedOrigin?.(origin) ?? origin === new URL(c.req.url).origin))
      return c.json({ status: "forbidden" }, 403);
    if (c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json")
      return c.json({ status: "invalid_request" }, 400);
    try {
      const input = ChangeClientBindingSchema.safeParse(await c.req.json());
      if (!input.success) return c.json({ status: "invalid_request" }, 400);
      if (!deps.bindingCommands) return c.json({ status: "disabled" }, 503);
      const result = await deps.bindingCommands.change(actor, input.data);
      await deps.changed?.(actor);
      return c.json(result);
    } catch (error) {
      if (error instanceof SyntaxError) return c.json({ status: "invalid_request" }, 400);
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  // Location data and proof bearers travel in POST bodies on the product boundary.
  for (const action of ["locations/search", "locations/proof", "buildings"] as const) {
    app.post(`/api/agent-plane/${action}`, async (c) => {
      c.header("Cache-Control", "no-store");
      const actor = await deps.sessionActor(c.req.raw);
      if (!actor) return c.json({ status: "unauthorized" }, 401);
      const origin = c.req.header("origin");
      if (origin && !(deps.trustedOrigin?.(origin) ?? origin === new URL(c.req.url).origin))
        return c.json({ status: "forbidden" }, 403);
      if (c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json")
        return c.json({ status: "invalid_request" }, 400);
      try {
        if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
        const operationId = c.req.header("Idempotency-Key");
        if (operationId !== undefined && !HierarchyOperationIdSchema.safeParse(operationId).success)
          return c.json({ status: "invalid_request" }, 400);
        const source = deps.source;
        const revision = c.req.header("x-rakazo-binding-revision");
        const { binding } = await read(
          actor,
          revision === undefined ? undefined : Number(revision),
        );
        const body: unknown = await c.req.json();
        if (action === "locations/search") {
          const input = LocationQuerySchema.safeParse(body);
          if (!input.success) return c.json({ status: "invalid_request" }, 400);
          if (!source?.searchLocations) return c.json({ status: "disabled" }, 503);
          const result = await source.searchLocations(input.data.query);
          await deps.resolveBinding(actor, binding.revision);
          return c.json(result);
        }
        if (action === "locations/proof") {
          const input = LocationProofInputSchema.safeParse(body);
          if (!input.success) return c.json({ status: "invalid_request" }, 400);
          if (!source?.proveLocation) return c.json({ status: "disabled" }, 503);
          const result = await source.proveLocation(input.data.verification_token);
          await deps.resolveBinding(actor, binding.revision);
          return c.json(result);
        }
        const input = CreateBuildingSchema.safeParse(body);
        if (!input.success) return c.json({ status: "invalid_request" }, 400);
        if (!source?.createBuilding) return c.json({ status: "disabled" }, 503);
        if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
        const result = await source.createBuilding(
          binding.externalClientId,
          input.data,
          operationId,
        );
        await deps.resolveBinding(actor, binding.revision);
        const botId = await deps.buildingManager?.(actor, result, binding.revision);
        await deps.changed?.(actor);
        return c.json({ ...result, ...(botId ? { botId } : {}) }, 201);
      } catch (error) {
        if (error instanceof SyntaxError) return c.json({ status: "invalid_request" }, 400);
        const result = failure(error);
        return c.json(result.body, result.status);
      }
    });
  }
  app.post("/api/agent-plane/projects", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
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
      if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
      const { hierarchy, binding } = await read(
        actor,
        c.req.header("x-rakazo-binding-revision") === undefined
          ? undefined
          : Number(c.req.header("x-rakazo-binding-revision")),
      );
      // A role can change while the upstream read is in flight; re-check before the write.
      if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
      const building = hierarchy.buildings.find((item) => item.id === input.data.buildingId);
      if (!building) return c.json({ error: "Building unavailable" }, 404);
      const operationId = c.req.header("Idempotency-Key");
      if (operationId !== undefined && !HierarchyOperationIdSchema.safeParse(operationId).success)
        return c.json({ status: "invalid_request" }, 400);
      const project = await source.createProject(
        input.data.buildingId,
        input.data.name,
        operationId,
      );
      await deps.resolveBinding(actor, binding.revision);
      const projects = hierarchy.buildings.flatMap((item) => item.projects);
      const finishSetup =
        projects.length === 0 || (projects.length === 1 && projects[0]?.id === project.id);
      const botId = await deps.projectManager?.(actor, project, binding.revision, finishSetup);
      await deps.changed?.(actor);
      return c.json({ ...project, ...(botId ? { botId } : {}) }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "Project already exists")
        return c.json({ error: "Project already exists" }, 409);
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  for (const method of ["patch", "delete"] as const) {
    app[method]("/api/agent-plane/projects/:id", async (c) => {
      c.header("Cache-Control", "no-store");
      const actor = await deps.sessionActor(c.req.raw);
      if (!actor) return c.json({ status: "unauthorized" }, 401);
      const origin = c.req.header("origin");
      if (origin && !(deps.trustedOrigin?.(origin) ?? origin === new URL(c.req.url).origin))
        return c.json({ status: "forbidden" }, 403);
      if (
        c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json" ||
        new URL(c.req.url).search
      )
        return c.json({ status: "invalid_request" }, 400);
      try {
        const body = await c.req.json();
        const schema = method === "patch" ? RenameProjectSchema : ProjectMutationSchema;
        const input = schema.safeParse({ ...body, projectId: c.req.param("id") });
        if (!input.success) return c.json({ status: "invalid_request" }, 400);
        if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
        const revision = c.req.header("x-rakazo-binding-revision");
        const { hierarchy, binding } = await read(
          actor,
          revision === undefined ? undefined : Number(revision),
        );
        const building = hierarchy.buildings.find((item) =>
          item.projects.some((project) => project.id === input.data.projectId),
        );
        const project = building?.projects.find((item) => item.id === input.data.projectId);
        if (!project || !building) return c.json({ status: "project_unavailable" }, 404);
        if (!(await deps.canCreateProject?.(actor))) return c.json({ status: "forbidden" }, 403);
        if (method === "delete") {
          if (input.data.name !== project.name)
            return c.json({ status: "confirmation_mismatch" }, 400);
          if (!deps.source?.deleteProject || !deps.retireProject)
            return c.json({ status: "disabled" }, 503);
          // Retire credentials before the irreversible upstream cascade. A retry is safe.
          try {
            await deps.retireProject(actor, project.id, binding.revision);
            await deps.resolveBinding(actor, binding.revision);
            await deps.source.deleteProject(project.id, project.name);
          } catch (error) {
            // Retirement can archive a bot before a revocation error. Publish that committed state.
            await deps.changed?.(actor);
            throw error;
          }
        } else {
          if (!deps.source?.renameProject) return c.json({ status: "disabled" }, 503);
          await deps.source.renameProject(project.id, input.data.name, building.id);
        }
        await deps.auditProject?.(actor, project.id, method === "patch" ? "rename" : "delete");
        await deps.changed?.(actor);
        await deps.resolveBinding(actor, binding.revision);
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof SyntaxError) return c.json({ status: "invalid_request" }, 400);
        const result = failure(error);
        return c.json(result.body, result.status);
      }
    });
  }
  app.get("/api/agent-plane/projects/:id/documents/:documentId/preview", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'self'");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.body(null, 401);
    if (!deps.authorizePreview || !deps.source?.previewDocument) return c.body(null, 503);
    const parsed = CommercialInspectionSelectionSchema.safeParse({
      projectId: c.req.param("id"),
      bindingRevision: Number(c.req.header("x-rakazo-binding-revision")),
      claimId: c.req.query("claimId"),
      vendorId: c.req.query("vendorId"),
      packageId: c.req.query("packageId"),
      fileId: c.req.param("documentId"),
    });
    if (!parsed.success || !parsed.data.vendorId || !parsed.data.packageId || !c.req.query("botId"))
      return c.body(null, 400);
    try {
      await deps.authorizePreview(actor, c.req.query("botId")!, parsed.data);
      const response = await deps.source.previewDocument(parsed.data.fileId!);
      // A binding change during the external read invalidates the result.
      await deps.resolveBinding(actor, parsed.data.bindingRevision);
      if (response.status === 415) return c.body(null, 415);
      if (!response.ok) return c.body(null, 502);
      c.header("Content-Type", response.headers.get("content-type")!);
      c.header("Content-Disposition", "inline");
      return c.body(await response.arrayBuffer());
    } catch (error) {
      const result = failure(error);
      return c.body(null, result.status);
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
      const { hierarchy, binding } = await read(
        actor,
        c.req.header("x-rakazo-binding-revision") === undefined
          ? undefined
          : Number(c.req.header("x-rakazo-binding-revision")),
      );
      if (
        !hierarchy.buildings.some((building) =>
          building.projects.some((project) => project.id === id),
        )
      )
        return c.json({ error: "Project unavailable" }, 404);
      const commercial = await source.readCommercial(id, true);
      await deps.resolveBinding(actor, binding.revision);
      return c.json(commercial);
    } catch (error) {
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  app.get("/api/agent-plane/navigation", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ status: "unauthorized" }, 401);
    if (!deps.source || !deps.navigationBots) return c.body(null, 204);
    try {
      const revision = c.req.header("x-rakazo-binding-revision");
      if (revision !== undefined && !/^[1-9][0-9]*$/.test(revision))
        return c.json({ status: "invalid_request" }, 400);
      const { hierarchy, binding } = await read(
        actor,
        revision === undefined ? undefined : Number(revision),
      );
      await finishSingleProject(actor, hierarchy, binding);
      const buildingIds = new Set<string>();
      const projectIds = new Set<string>();
      for (const building of hierarchy.buildings) {
        if (buildingIds.has(building.id))
          throw new ORPCError("BAD_GATEWAY", { message: "invalid_hierarchy" });
        buildingIds.add(building.id);
        for (const project of building.projects) {
          if (projectIds.has(project.id))
            throw new ORPCError("BAD_GATEWAY", { message: "invalid_hierarchy" });
          projectIds.add(project.id);
        }
      }
      const bots = await deps.navigationBots(actor);
      const bySpawnKey = new Map<string, string>();
      const botIds = new Set<string>();
      for (const bot of bots) {
        if (!bot.spawnKey) continue;
        if (bySpawnKey.has(bot.spawnKey) || botIds.has(bot.id))
          throw new ORPCError("BAD_GATEWAY", { message: "invalid_hierarchy" });
        bySpawnKey.set(bot.spawnKey, bot.id);
        botIds.add(bot.id);
      }
      const assigned = (key: string) => {
        const id = bySpawnKey.get(key);
        return id ? [id] : [];
      };
      await deps.resolveBinding(actor, binding.revision);
      return c.json({
        spaceId: actor.spaceId,
        bindingRevision: binding.revision,
        client: hierarchy.client,
        setupBotIds: assigned(`setup:${binding.externalClientId}`),
        buildings: hierarchy.buildings.map((building) => ({
          id: building.id,
          name: building.name,
          botIds: assigned(`building:${building.id}`),
          projects: building.projects.map((project) => ({
            id: project.id,
            name: project.name,
            botIds: assigned(`pm:${project.id}`),
          })),
        })),
      });
    } catch (error) {
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
  app.get("/api/agent-plane/hierarchy", async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await deps.sessionActor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!deps.source) return c.body(null, 204);
    try {
      const revision = c.req.header("x-rakazo-binding-revision");
      if (revision !== undefined && !/^[1-9][0-9]*$/.test(revision))
        return c.json({ status: "invalid_request" }, 400);
      const { hierarchy, binding } = await read(
        actor,
        revision === undefined ? undefined : Number(revision),
      );
      await finishSingleProject(actor, hierarchy, binding);
      const setupBotId = (await deps.navigationBots?.(actor))?.find(
        (bot) => bot.spawnKey === `setup:${binding.externalClientId}`,
      )?.id;
      c.header("x-rakazo-binding-revision", String(binding.revision));
      return c.json({
        ...hierarchy,
        ...(setupBotId ? { setupBotId } : {}),
        bindingRevision: binding.revision,
        canManage: (await deps.canCreateProject?.(actor)) === true,
      });
    } catch (error) {
      const result = failure(error);
      return c.json(result.body, result.status);
    }
  });
}
