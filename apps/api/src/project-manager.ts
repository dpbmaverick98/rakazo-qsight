import { ORPCError } from "@orpc/server";
import { lockMcpOAuthMaterial, persistPreparedSecret } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { PROJECT_MANAGER_TOOLS, projectManagerToolPolicy, retry } from "@rakazo/core";
import type { Prisma } from "@rakazo/db";
import { lockSpaceDeletion } from "@rakazo/db";
import { bestEffort, clientSetupDebug, clientSetupStage } from "@rakazo/logging";
import { lockOwner } from "./availability.js";
import { mcpServerDto } from "./mcp-servers.js";
import { projectManagerInstructions } from "./project-manager.prompt.js";
import type { RouterContext } from "./routes/context.js";
import { bindingAccess, boundHierarchy, resolveClientBinding } from "./space-client-binding.js";

/** Token minting and endpoint validation finish before any product records change. */
export async function provisionProjectManager(
  ctx: RouterContext,
  actor: Actor,
  input: {
    projectId: string;
    projectName: string;
    clientName: string;
    bindingRevision?: number;
    finishSetup?: boolean;
  },
) {
  return clientSetupStage("promotion", { actorId: actor.userId, spaceId: actor.spaceId }, () =>
    provision(ctx, actor, input),
  );
}

async function provision(
  ctx: RouterContext,
  actor: Actor,
  input: {
    projectId: string;
    projectName: string;
    clientName: string;
    bindingRevision?: number;
    finishSetup?: boolean;
  },
) {
  const { deps, repos, prepareMcpServer, insertMcpServer } = ctx;
  const source = deps.projectManagers;
  if (!source) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "disabled" });
  await bindingAccess(deps.prisma, actor, true);
  const { hierarchy, binding } = await boundHierarchy(
    deps.prisma,
    actor,
    source,
    input.bindingRevision,
  ).catch((error) => {
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("BAD_GATEWAY", { message: "upstream_unavailable" });
  });
  const projects = hierarchy.buildings.flatMap((building) => building.projects);
  if (input.finishSetup && (projects.length !== 1 || projects[0]?.id !== input.projectId))
    throw new ORPCError("CONFLICT", { message: "Choose the only project to finish setup" });
  const building = hierarchy.buildings.find((item) =>
    item.projects.some((project) => project.id === input.projectId),
  );
  const project = building?.projects.find((item) => item.id === input.projectId);
  if (!project) throw new ORPCError("NOT_FOUND", { message: "Project unavailable" });
  // Old workers ignore inheritMcpServers. Refuse while a shared owner server could
  // expose every agent's tools to this PM during a rolling deployment.
  const shared = await deps.prisma.mcpServer.findFirst({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      allBots: true,
      OR: [
        { name: { startsWith: source.ownerServerPrefix } },
        { name: { startsWith: PROJECT_MANAGER_TOOLS.legacyServerPrefix } },
      ],
    },
    select: { id: true },
  });
  if (shared)
    throw new ORPCError("CONFLICT", {
      message:
        "Disable All bots on the owner-level Vendor One server before creating a project manager",
    });
  const { tokenId, ...config } = await source.managerServer(project.id, project.name).catch(() => {
    throw new ORPCError("BAD_GATEWAY", { message: "Project manager unavailable" });
  });
  let adopted = false;
  let persistedToken = false;
  try {
    const stored = await prepareMcpServer(actor, config);
    if (!stored) throw new ORPCError("INTERNAL_SERVER_ERROR");
    const result = await persistPreparedSecret(
      deps.prisma,
      deps.secrets,
      stored,
      async () => {
        let server: Awaited<ReturnType<typeof insertMcpServer>> | undefined;
        let seededBotId: string | undefined;
        let promoteSetup = false;
        const write = async (tx: Prisma.TransactionClient, botId: string) => {
          await lockSpaceDeletion(tx, actor.spaceId);
          await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${actor.spaceId} FOR UPDATE`;
          await bindingAccess(tx, actor, true);
          await resolveClientBinding(tx, actor, binding.revision);
          await lockOwner(tx, actor.userId, "names:mcpServer");
          const bot = await tx.bot.findFirst({
            where: { id: botId, spaceId: actor.spaceId, archivedAt: null },
          });
          if (!bot) throw new ORPCError("CONFLICT", { message: "Project manager unavailable" });
          if (
            promoteSetup &&
            bot.spawnKey !== `building:${building!.id}` &&
            bot.spawnKey !== `setup:${binding.externalClientId}`
          )
            throw new ORPCError("CONFLICT", { message: "Project manager scope changed" });
          if (!promoteSetup && bot.userId !== actor.userId)
            throw new ORPCError("CONFLICT", { message: "Project manager unavailable" });
          const scope = { spaceId: actor.spaceId, userId: actor.userId };
          const bySlug = await tx.mcpServer.findFirst({ where: { ...scope, slug: config.slug } });
          const byName = bySlug
            ? null
            : await tx.mcpServer.findFirst({ where: { ...scope, name: config.name } });
          // Names are display data: two projects can share one. Reject unproven legacy matches.
          const candidate = bySlug ?? (byName?.slug.startsWith("pm-") ? null : byName);
          if (candidate) {
            await lockMcpOAuthMaterial(tx, candidate.id);
            const existing = await tx.mcpServer.findFirst({
              where: { ...scope, id: candidate.id },
              include: { availableIn: { select: { spaceId: true } } },
            });
            if (!existing)
              throw new ORPCError("CONFLICT", { message: "Project manager unavailable" });
            // A display-name match alone cannot prove that credentials are project-scoped.
            if (
              existing.allBots ||
              existing.allSpaces ||
              existing.transport !== "streamable_http" ||
              existing.availableIn.some((space) => space.spaceId !== actor.spaceId)
            )
              throw new ORPCError("CONFLICT", {
                message: "Project manager connection conflicts with an existing server",
              });
            const boundToOthers = await tx.botMcpServer.count({
              where: {
                spaceId: actor.spaceId,
                userId: actor.userId,
                serverId: candidate.id,
                botId: { not: botId },
              },
            });
            if (boundToOthers)
              throw new ORPCError("CONFLICT", {
                message: "Project manager connection conflicts with an existing server",
              });
            // A stable project slug proves this is a connection created by this flow.
            // Reuse it rather than replacing an active credential on every retry.
            if (
              existing.slug !== config.slug ||
              !existing.secretId ||
              !existing.managedCredentialId
            )
              throw new ORPCError("CONFLICT", {
                message: "Project manager connection requires repair",
              });
            server = existing;
          } else {
            const inserted = await insertMcpServer(tx, actor, config, stored);
            server = await tx.mcpServer.update({
              where: { id: inserted.id },
              data: { managedCredentialId: tokenId },
            });
          }
          await tx.bot.update({
            where: { id: botId },
            data: {
              inheritMcpServers: false,
              crossSpaceCommunication: false,
              ...(promoteSetup
                ? {
                    spawnKey: `pm:${project.id}`,
                    name: "Proj. Manager - Sam",
                    instructions: projectManagerInstructions(project, hierarchy.client.name),
                  }
                : {}),
            },
          });
          const previousAssignment = await tx.botMcpServer.findFirst({
            where: { botId, serverId: server.id, spaceId: actor.spaceId, userId: actor.userId },
          });
          await tx.botMcpServer.deleteMany({ where: { botId, spaceId: actor.spaceId } });
          await tx.botMcpServer.create({
            data: {
              botId,
              serverId: server.id,
              spaceId: actor.spaceId,
              userId: actor.userId,
              ...projectManagerToolPolicy(previousAssignment?.trustedTools),
            },
          });
          seededBotId = botId;
        };
        const spawnKey = `pm:${project.id}`;
        const bots = await repos.listBots(actor);
        // Any current Space owner/admin can finish/kill the setup PM, not only its creator.
        const setup = bots.find((bot) => bot.spawnKey === `setup:${binding.externalClientId}`);
        const buildingManager = bots.find((bot) => bot.spawnKey === `building:${building!.id}`);
        const existing =
          bots.find((bot) => bot.spawnKey === spawnKey) ??
          buildingManager ??
          (input.finishSetup ? setup : undefined);
        promoteSetup =
          !!existing && (existing.id === buildingManager?.id || existing.id === setup?.id);
        const bot =
          existing ??
          (await repos.createBot(actor, {
            name: "Proj. Manager - Sam",
            spawnKey,
            description: "",
            initialMessage: {
              role: "bot",
              blocks: [
                { kind: "text", text: "What scope of work should I plan for this project?" },
              ],
            },
            instructions: projectManagerInstructions(project, hierarchy.client.name),
            notifyOnFinish: false,
            dailyCheckIns: false,
            fleetManagement: false,
            seed: write,
          }));
        const created = !existing && seededBotId === bot.id;
        // createBot returns the winner after a concurrent spawn-key conflict; repair older PMs too.
        if (seededBotId !== bot.id) await deps.prisma.$transaction((tx) => write(tx, bot.id));
        if (!server) throw new ORPCError("INTERNAL_SERVER_ERROR");
        persistedToken = server.secretId === stored.id;
        return {
          bot: promoteSetup
            ? {
                ...bot,
                spawnKey,
                name: "Proj. Manager - Sam",
                instructions: projectManagerInstructions(project, hierarchy.client.name),
                inheritMcpServers: false,
                crossSpaceCommunication: false,
              }
            : bot,
          server: mcpServerDto(server),
          created,
        };
      },
      () => {
        adopted = persistedToken;
      },
    );
    await deps.events.publishRosterChange?.({ spaceIds: [actor.spaceId] });
    clientSetupDebug("promotion", {
      actorId: actor.userId,
      spaceId: actor.spaceId,
      clientId: binding.externalClientId,
      botId: result.bot.id,
      serverId: result.server.id,
      status: "committed",
    });
    return result;
  } finally {
    if (!adopted)
      await bestEffort(
        "revoke unused project manager token",
        clientSetupStage("token.revoke", { actorId: actor.userId, spaceId: actor.spaceId }, () =>
          retry(() => source.revokeManagerToken(tokenId), {
            attempts: 3,
            delayMs: [100, 500],
            retryable: () => true,
          }),
        ),
      );
  }
}
