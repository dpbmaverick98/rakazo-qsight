import { createHash } from "node:crypto";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import {
  CreatedProjectSchema,
  CreateProjectSchema,
  HierarchySchema,
} from "@rakazo/contracts/hierarchy";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import { deadlineSignal, PROJECT_MANAGER_TOOLS, readBoundedJsonResponse } from "@rakazo/core";
import { z } from "zod";

const Id = z
  .union([
    z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value !== "." && value !== ".."),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const Name = z.string().trim().min(1).max(500);
const ResponseSchema = z.object({
  client: z.object({ id: Id, name: Name }),
  buildings: z
    .array(
      z.object({
        id: Id,
        name: Name,
        latitude: z.number().min(-90).max(90).nullable().catch(null),
        longitude: z.number().min(-180).max(180).nullable().catch(null),
        projects: z.array(z.object({ id: Id, name: Name })).max(5000),
      }),
    )
    .max(5000),
});

/** Server composition only: credentials and upstream translation stay inside this adapter. */
export function qsightHierarchyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const {
    QSIGHT_BASE_URL: base,
    QSIGHT_AGENT_TOKEN: token,
    QSIGHT_CLIENT_ID: clientId,
    QSIGHT_SPACE_ID: spaceId,
  } = env;
  if (!base || !token) return null;
  const origin = new URL(base);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("Hierarchy base URL must be an HTTP(S) origin");
  }
  const localHttp = new Set(["127.0.0.1", "localhost", "[::1]", "host.docker.internal"]);
  if (origin.protocol === "http:" && !localHttp.has(origin.hostname)) {
    throw new Error("Hierarchy HTTP is allowed only for loopback/local Docker; use HTTPS");
  }
  const cache = new Map<string, { data: Hierarchy; expires: number }>();
  const commercialCache = new Map<
    string,
    { data: ReturnType<typeof ProjectCommercialSchema.parse>; expires: number }
  >();
  return {
    spaceId,
    async createProject(buildingId: string, name: string) {
      const input = CreateProjectSchema.parse({ buildingId, name });
      const signal = deadlineSignal(5000);
      try {
        const response = await fetch(
          new URL(
            `/api/v2/agent/buildings/${encodeURIComponent(input.buildingId)}/projects`,
            origin,
          ),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: input.name }),
            redirect: "error",
            signal,
          },
        );
        if (response.status === 409) throw new Error("Project already exists");
        if (!response.ok) throw new Error("Project creation unavailable");
        // A successful write must invalidate reads even when its response is malformed.
        cache.clear();
        const project = CreatedProjectSchema.extend({ id: Id, building_id: Id }).parse(
          await readBoundedJsonResponse(response, 32_000, signal),
        );
        if (project.building_id !== input.buildingId)
          throw new Error("Project creation unavailable");
        project.url = new URL(`/projects/${encodeURIComponent(project.id)}`, origin).href;
        return project;
      } catch (error) {
        if (error instanceof Error && error.message === "Project already exists") throw error;
        throw new Error("Project creation unavailable");
      }
    },
    async managerServer(id: string, name: string) {
      const signal = deadlineSignal(5000);
      try {
        const response = await fetch(
          new URL(`/api/v2/agent/projects/${encodeURIComponent(id)}/manager-token`, origin),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            redirect: "error",
            signal,
          },
        );
        if (!response.ok) throw new Error("Token unavailable");
        const minted = z
          .object({
            token: z
              .string()
              .min(1)
              .max(16384)
              .refine((value) => !/[\r\n]/.test(value)),
          })
          .parse(await readBoundedJsonResponse(response, 32_000, signal));
        return {
          slug: `pm-${createHash("sha256").update(id).digest("hex").slice(0, 60)}`,
          name: `${PROJECT_MANAGER_TOOLS.managerServerPrefix}${name}`.slice(0, 120),
          description: "",
          enabled: true,
          verbatimResults: false,
          transport: "streamable_http" as const,
          endpoint: env.QSIGHT_MCP_ENDPOINT || new URL("/mcp", origin).href,
          headers: { Authorization: `Bearer ${minted.token}` },
        };
      } catch {
        // Parsing and network errors can contain credentials; never forward them.
        throw new Error("Project manager credentials unavailable");
      }
    },
    async readCommercial(id: string) {
      // The API verifies membership in this client hierarchy before every read.
      const hit = commercialCache.get(id);
      if (hit && hit.expires > Date.now()) return hit.data;
      commercialCache.delete(id);
      const signal = deadlineSignal(5000);
      const response = await fetch(
        new URL(`/api/v2/agent/projects/${encodeURIComponent(id)}/commercial`, origin),
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          redirect: "error",
          signal,
        },
      );
      if (!response.ok) throw new Error("Commercial upstream unavailable");
      const data = ProjectCommercialSchema.parse(
        await readBoundedJsonResponse(response, 256_000, signal),
      );
      if (data.project.id !== id) throw new Error("Commercial project mismatch");
      // Generate links from canonical IDs; never trust content-supplied URLs.
      data.project.url = new URL(`/projects/${encodeURIComponent(id)}`, origin).href;
      for (const claim of data.claims)
        for (const vendor of claim.sub_vendors)
          for (const item of vendor.work_packages) {
            item.url = new URL(
              `/projects/${encodeURIComponent(id)}/packages/${encodeURIComponent(item.id)}`,
              origin,
            ).href;
          }
      if (commercialCache.size >= 100) commercialCache.delete(commercialCache.keys().next().value!);
      commercialCache.set(id, { data, expires: Date.now() + 15_000 });
      return data;
    },
    async read(clientName?: string, fresh = false): Promise<Hierarchy> {
      // A supplied name must never fall back to the deployment's legacy client.
      const name = clientName === undefined ? undefined : Name.parse(clientName);
      if (name === undefined && !clientId) throw new Error("Hierarchy client required");
      const key = name === undefined ? `id:${clientId}` : `name:${name}`;
      const cached = cache.get(key);
      if (!fresh && cached && cached.expires > Date.now()) return cached.data;
      cache.delete(key);
      const url = new URL("/api/v2/agent/hierarchy", origin);
      url.searchParams.set(name === undefined ? "client_id" : "client_name", name ?? clientId!);
      const signal = deadlineSignal(5000);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Hierarchy upstream unavailable");
      const raw = ResponseSchema.parse(await readBoundedJsonResponse(response, 1_000_000, signal));
      if (name === undefined ? raw.client.id !== clientId : raw.client.name !== name)
        throw new Error("Hierarchy client mismatch");
      const data = HierarchySchema.parse({
        client: raw.client,
        buildings: raw.buildings.map((building) => ({
          ...building,
          projects: building.projects.map((project) => ({
            ...project,
            url: new URL(`/projects/${encodeURIComponent(project.id)}`, origin).href,
          })),
        })),
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { data, expires: Date.now() + 15_000 });
      return data;
    },
  };
}
