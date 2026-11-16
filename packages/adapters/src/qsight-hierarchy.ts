import { createHash } from "node:crypto";
import type { CreateBuilding, Hierarchy } from "@rakazo/contracts/hierarchy";
import {
  CreateBuildingSchema,
  CreatedBuildingSchema,
  CreatedProjectSchema,
  CreateProjectSchema,
  HierarchySchema,
  LocationCandidatesSchema,
  LocationProofInputSchema,
  LocationProofSchema,
  LocationQuerySchema,
  ProjectMutationSchema,
  RenameProjectSchema,
} from "@rakazo/contracts/hierarchy";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import type {
  CompleteIntakeFileBody,
  IntakeReviewBody,
  ProjectIntakeManifestFile,
} from "@rakazo/contracts/project-intake";
import {
  CompletionResponseSchema,
  ProjectIntakeViewSchema,
} from "@rakazo/contracts/project-intake";
import {
  deadlineSignal,
  PROJECT_MANAGER_TOOLS,
  readBoundedJsonResponse,
  readBoundedResponseBytes,
  withAbort,
} from "@rakazo/core";
import { bestEffort, clientSetupCorrelationHeaders, clientSetupStage } from "@rakazo/logging";
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
const Client = z.object({ id: Id, name: Name, url: z.url({ protocol: /^https?$/ }) });
const ResponseSchema = z.object({
  client: z.object({ id: Id, name: Name }),
  buildings: z
    .array(
      z.object({
        id: Id,
        name: z.string().trim().max(500).nullish(),
        address: z.string().trim().max(2000).nullable().optional(),
        latitude: z.number().min(-90).max(90).nullable().catch(null),
        longitude: z.number().min(-180).max(180).nullable().catch(null),
        projects: z.array(z.object({ id: Id, name: Name })).max(5000),
      }),
    )
    .max(5000),
});

/** Server composition only: credentials and upstream translation stay inside this adapter. */
export function qsightHierarchyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const { QSIGHT_BASE_URL: base, QSIGHT_AGENT_TOKEN: token, QSIGHT_SPACE_ID: spaceId } = env;
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
  async function upstream(
    operation: string,
    url: URL,
    init: Omit<RequestInit, "headers"> & { headers: Record<string, string> },
  ) {
    const headers = { ...init.headers };
    const correlation = clientSetupCorrelationHeaders();
    for (const [key, value] of Object.entries(correlation)) headers[key] = value;
    const fields = {
      operation,
      requestId: correlation["x-request-id"],
      httpStatus: undefined as number | undefined,
      status: "ok",
      errorCode: undefined as string | undefined,
    };
    return clientSetupStage("upstream", fields, async () => {
      const response = await fetch(url, { ...init, headers });
      fields.httpStatus = response.status;
      fields.status = response.ok ? "ok" : "error";
      if (!response.ok) fields.errorCode = "upstream_http_error";
      return response;
    });
  }
  async function intakeRequest<T>(
    path: string,
    method: string,
    scopedToken: string,
    schema: z.ZodType<T>,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const signal = deadlineSignal(15_000);
    let response: Response;
    try {
      response = await upstream("intake.request", new URL(path, origin), {
        method,
        headers: {
          Authorization: `Bearer ${scopedToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch {
      throw new Error("Intake upstream unavailable");
    }
    if (response.status === 409) throw new Error("Intake conflict");
    if (response.status === 401 || response.status === 403)
      throw new Error("Intake authorization failed");
    if (!response.ok) throw new Error("Intake upstream unavailable");
    try {
      return schema.parse(await readBoundedJsonResponse(response, 1_000_000, signal));
    } catch {
      throw new Error("Intake upstream unavailable");
    }
  }
  async function revokeManagerToken(tokenId: string) {
    const id = Id.parse(tokenId);
    const signal = deadlineSignal(5000);
    const response = await upstream(
      "token.revoke",
      new URL(`/api/v2/agent/tokens/${encodeURIComponent(id)}`, origin),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      },
    ).catch(() => {
      throw new Error("Token revocation unavailable");
    });
    // An already absent token is revoked; cleanup must survive an interrupted retry.
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) throw new Error("Token revocation unavailable");
    try {
      z.object({ revoked: z.boolean() }).parse(
        await readBoundedJsonResponse(response, 1000, signal),
      );
    } catch {
      throw new Error("Token revocation unavailable");
    }
  }
  return {
    async createIntake(
      projectId: string,
      files: ProjectIntakeManifestFile[],
      idempotencyKey: string,
      token: string,
    ) {
      const project_id = Id.parse(projectId);
      const view = await intakeRequest(
        `/api/v2/agent/projects/${encodeURIComponent(project_id)}/intakes`,
        "POST",
        token,
        ProjectIntakeViewSchema,
        { project_id, files },
        idempotencyKey,
      );
      if (view.project_id !== project_id) throw new Error("Intake upstream unavailable");
      return view;
    },
    completeIntakeFile(
      intakeId: string,
      fileId: string,
      body: CompleteIntakeFileBody,
      token: string,
    ) {
      return intakeRequest(
        `/api/v2/agent/intakes/${encodeURIComponent(Id.parse(intakeId))}/files/${encodeURIComponent(Id.parse(fileId))}/complete`,
        "POST",
        token,
        CompletionResponseSchema,
        body,
      );
    },
    readIntake(intakeId: string, token: string) {
      return intakeRequest(
        `/api/v2/agent/intakes/${encodeURIComponent(Id.parse(intakeId))}`,
        "GET",
        token,
        ProjectIntakeViewSchema,
      );
    },
    saveIntakeReview(intakeId: string, body: IntakeReviewBody, token: string) {
      return intakeRequest(
        `/api/v2/agent/intakes/${encodeURIComponent(Id.parse(intakeId))}/review`,
        "PATCH",
        token,
        ProjectIntakeViewSchema,
        body,
      );
    },
    spaceId,
    ownerServerPrefix: PROJECT_MANAGER_TOOLS.name,
    /** A null result means the upstream returned 409; recover with findClient. */
    async createClient(name: string) {
      const input = Name.parse(name);
      const signal = deadlineSignal(5000);
      try {
        const response = await upstream("client.create", new URL("/api/v2/agent/clients", origin), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: input }),
          redirect: "error",
          signal,
        });
        if (response.status === 409) return null;
        if (response.status !== 201) throw new Error("Client creation unavailable");
        const client = Client.parse(await readBoundedJsonResponse(response, 32_000, signal));
        if (
          client.name !== input ||
          new URL(client.url).pathname !== `/clients/${encodeURIComponent(client.id)}`
        )
          throw new Error("Client creation unavailable");
        return client;
      } catch {
        throw new Error("Client creation unavailable");
      }
    },
    async findClient(name: string) {
      const input = Name.parse(name);
      const signal = deadlineSignal(5000);
      try {
        const url = new URL("/api/v2/agent/clients", origin);
        url.searchParams.set("name", input);
        const response = await upstream("client.lookup", url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          redirect: "error",
          signal,
        });
        if (!response.ok) throw new Error("Client lookup unavailable");
        const { items } = z
          .object({ items: z.array(Client).max(100) })
          .parse(await readBoundedJsonResponse(response, 128_000, signal));
        const matches = items.filter((client) => client.name === input);
        if (matches.length > 1) throw new Error("Client lookup unavailable");
        const client = matches[0] ?? null;
        if (client && new URL(client.url).pathname !== `/clients/${encodeURIComponent(client.id)}`)
          throw new Error("Client lookup unavailable");
        return client;
      } catch (error) {
        throw new Error(
          `Client lookup unavailable: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    },
    async searchLocations(query: string) {
      const input = LocationQuerySchema.parse({ query });
      const url = new URL("/api/v2/agent/locations/search", origin);
      url.searchParams.set("query", input.query);
      const signal = deadlineSignal(5000);
      const response = await upstream("location.search", url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Location search unavailable");
      return LocationCandidatesSchema.parse(
        await readBoundedJsonResponse(response, 128_000, signal),
      );
    },
    async proveLocation(verificationToken: string) {
      const input = LocationProofInputSchema.parse({ verification_token: verificationToken });
      const signal = deadlineSignal(5000);
      const response = await upstream(
        "location.proof",
        new URL("/api/v2/agent/locations/proof", origin),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal,
        },
      );
      if (!response.ok) throw new Error("Location confirmation unavailable");
      return LocationProofSchema.parse(await readBoundedJsonResponse(response, 32_000, signal));
    },
    async createBuilding(clientId: string, data: CreateBuilding, operationId?: string) {
      const client_id = Id.parse(clientId);
      const input = { client_id, ...CreateBuildingSchema.parse(data) };
      const signal = deadlineSignal(5000);
      const response = await upstream(
        "building.create",
        new URL("/api/v2/agent/buildings", origin),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": createHash("sha256")
              .update(JSON.stringify(["building", input, operationId ?? null]))
              .digest("hex"),
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal,
        },
      );
      if (!response.ok) throw new Error("Building creation unavailable");
      cache.clear();
      const building = CreatedBuildingSchema.extend({ id: Id, client_id: Id }).parse(
        await readBoundedJsonResponse(response, 32_000, signal),
      );
      if (
        building.client_id !== client_id ||
        building.address !== input.address ||
        building.name !== input.nickname
      )
        throw new Error("Building creation mismatch");
      building.url = new URL(`/buildings/${encodeURIComponent(building.id)}`, origin).href;
      return building;
    },
    async createProject(buildingId: string, name: string, operationId?: string) {
      const input = CreateProjectSchema.parse({ buildingId, name });
      const signal = deadlineSignal(5000);
      try {
        const response = await upstream(
          "project.create",
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
              "Idempotency-Key": createHash("sha256")
                .update(
                  JSON.stringify(["project", input.buildingId, input.name, operationId ?? null]),
                )
                .digest("hex"),
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
    async renameProject(projectId: string, name: string, buildingId: string) {
      const input = RenameProjectSchema.parse({ projectId, name });
      const expectedBuilding = Id.parse(buildingId);
      const signal = deadlineSignal(5000);
      try {
        const response = await upstream(
          "project.rename",
          new URL(`/api/v2/projects/${encodeURIComponent(input.projectId)}`, origin),
          {
            method: "PATCH",
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
        if (!response.ok) throw new Error();
        cache.clear();
        commercialCache.delete(input.projectId);
        const project = z
          .object({ id: Id, name: Name, building_id: Id })
          .parse(await readBoundedJsonResponse(response, 32_000, signal));
        if (
          project.id !== input.projectId ||
          project.name !== input.name ||
          project.building_id !== expectedBuilding
        )
          throw new Error();
        return project;
      } catch {
        throw new Error("Project rename unavailable");
      }
    },
    async deleteProject(projectId: string, name: string) {
      const input = ProjectMutationSchema.parse({ projectId, name });
      const signal = deadlineSignal(5000);
      try {
        const response = await upstream(
          "project.delete",
          new URL(`/api/v2/projects/${encodeURIComponent(input.projectId)}`, origin),
          {
            method: "DELETE",
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
        if (response.status !== 204) throw new Error();
        cache.clear();
        commercialCache.delete(input.projectId);
      } catch {
        throw new Error("Project deletion unavailable");
      }
    },
    revokeManagerToken,
    async managerServer(id: string, name: string) {
      let mintedId: string | undefined;
      const signal = deadlineSignal(5000);
      try {
        const response = await upstream(
          "token.create",
          new URL(`/api/v2/agent/projects/${encodeURIComponent(id)}/manager-token`, origin),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            redirect: "error",
            signal,
          },
        );
        if (!response.ok) throw new Error("Token unavailable");
        const raw: unknown = await readBoundedJsonResponse(response, 32_000, signal);
        mintedId = z.object({ token_id: Id }).parse(raw).token_id;
        const minted = z
          .object({
            token_id: Id,
            project_id: Id,
            token: z
              .string()
              .min(1)
              .max(16384)
              .refine((value) => !/[\r\n]/.test(value)),
          })
          .parse(raw);
        if (minted.project_id !== id) throw new Error("Project mismatch");
        return {
          tokenId: minted.token_id,
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
        if (mintedId)
          await bestEffort("revoke malformed project credential", revokeManagerToken(mintedId));
        // Parsing and network errors can contain credentials; never forward them.
        throw new Error("Project manager credentials unavailable");
      }
    },
    // Integration-unverified: implements the upstream agent document preview contract.
    async previewDocument(documentId: string): Promise<Response> {
      const signal = deadlineSignal(15_000);
      try {
        const response = await upstream(
          "document.preview",
          new URL(
            `/api/v2/agent/documents/${encodeURIComponent(Id.parse(documentId))}/preview`,
            origin,
          ),
          { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal },
        );
        if (response.status === 415) return new Response(null, { status: 415 });
        if (!response.ok) throw new Error();
        const type = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (
          !type ||
          ![
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "text/markdown",
            "text/plain",
          ].includes(type)
        )
          return new Response(null, { status: 415 });
        const bytes = await readBoundedResponseBytes(response, {
          maxBytes: type.startsWith("text/") ? 256 * 1024 : 20_000_000,
          tooLargeMessage: "Preview unavailable",
          read: (operation) => withAbort(operation(), signal),
        });
        return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": type } });
      } catch {
        throw new Error("Preview unavailable");
      }
    },
    async readCommercial(id: string, fresh = false) {
      // The API verifies membership in this client hierarchy before every read.
      const hit = commercialCache.get(id);
      if (!fresh && hit && hit.expires > Date.now()) return hit.data;
      commercialCache.delete(id);
      const signal = deadlineSignal(5000);
      const response = await upstream(
        "commercial.read",
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
            for (const document of item.documents ?? []) {
              document.package_url = item.url;
              const record = new URL(item.url);
              record.searchParams.set("document", document.id);
              document.url = record.href;
            }
          }
      if (commercialCache.size >= 100) commercialCache.delete(commercialCache.keys().next().value!);
      commercialCache.set(id, { data, expires: Date.now() + 15_000 });
      return data;
    },
    async read(externalClientId: string, fresh = false): Promise<Hierarchy> {
      const id = Id.parse(externalClientId);
      if (!id.trim()) throw new Error("Hierarchy client required");
      const key = id;
      const cached = cache.get(key);
      if (!fresh && cached && cached.expires > Date.now()) return cached.data;
      cache.delete(key);
      const url = new URL("/api/v2/agent/hierarchy", origin);
      url.searchParams.set("client_id", id);
      const signal = deadlineSignal(5000);
      const response = await upstream("hierarchy.read", url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Hierarchy upstream unavailable");
      const raw = ResponseSchema.parse(await readBoundedJsonResponse(response, 1_000_000, signal));
      if (raw.client.id !== id) throw new Error("Hierarchy client mismatch");
      const data = HierarchySchema.parse({
        client: raw.client,
        buildings: raw.buildings.map((building) => ({
          ...building,
          name: building.name || building.address?.slice(0, 500) || "Building",
          address: building.address || null,
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
