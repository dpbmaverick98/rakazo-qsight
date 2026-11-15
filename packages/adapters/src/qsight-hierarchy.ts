import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import { deadlineSignal, readBoundedJsonResponse } from "@rakazo/core";
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
  if (!base || !token || !clientId || !spaceId) return null;
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
  let cached: { data: Hierarchy; expires: number } | undefined;
  return {
    spaceId,
    async read(): Promise<Hierarchy> {
      if (cached && cached.expires > Date.now()) return cached.data;
      const url = new URL("/api/v2/agent/hierarchy", origin);
      url.searchParams.set("client_id", clientId);
      const signal = deadlineSignal(5000);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Hierarchy upstream unavailable");
      const raw = ResponseSchema.parse(await readBoundedJsonResponse(response, 1_000_000, signal));
      if (raw.client.id !== clientId) throw new Error("Hierarchy client mismatch");
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
      cached = { data, expires: Date.now() + 15_000 };
      return data;
    },
  };
}
