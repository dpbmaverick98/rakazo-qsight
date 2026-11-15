import { ORPCError } from "@orpc/server";
import { lockMcpOAuthMaterial, persistPreparedSecret } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { itemSecretIn } from "@rakazo/db";
import { lockOwner } from "./availability.js";
import { mcpServerDto } from "./mcp-servers.js";
import { projectManagerInstructions } from "./project-manager.prompt.js";
import type { RouterContext } from "./routes/context.js";

/** Token minting and endpoint validation finish before any product records change. */
export async function provisionProjectManager(
  ctx: RouterContext,
  actor: Actor,
  input: { projectId: string; projectName: string; clientName: string },
) {
  const { deps, repos, prepareMcpServer, insertMcpServer } = ctx;
  const source = deps.projectManagers;
  if (!source || source.spaceId !== actor.spaceId)
    throw new ORPCError("NOT_FOUND", { message: "Project unavailable" });
  const space = await deps.prisma.space.findFirst({ where: { id: actor.spaceId } });
  if (!space || space.isDefault)
    throw new ORPCError("NOT_FOUND", { message: "Project unavailable" });
  // Only canonical upstream names enter instructions or deterministic resource names.
  const hierarchy = await source.read().catch(() => {
    throw new ORPCError("BAD_GATEWAY", { message: "Project unavailable" });
  });
  const project = hierarchy.buildings
    .flatMap((building) => building.projects)
    .find((item) => item.id === input.projectId);
  if (!project) throw new ORPCError("NOT_FOUND", { message: "Project unavailable" });
  const config = await source.managerServer(project.id, project.name).catch(() => {
    throw new ORPCError("BAD_GATEWAY", { message: "Project manager unavailable" });
  });
  // Old workers ignore inheritMcpServers. Refuse while a shared owner server could
  // expose every agent's tools to this PM during a rolling deployment.
  const shared = await deps.prisma.mcpServer.findFirst({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      allBots: true,
      name: { startsWith: "QSight" },
    },
    select: { id: true },
  });
  if (shared)
    throw new ORPCError("CONFLICT", {
      message: "Disable All bots on the owner-level QSight server before creating a project manager",
    });
  const stored = await prepareMcpServer(actor, config);
  if (!stored) throw new ORPCError("INTERNAL_SERVER_ERROR");
  return persistPreparedSecret(deps.prisma, deps.secrets, stored, async () => {
    let server: Awaited<ReturnType<typeof insertMcpServer>> | undefined;
    let seededBotId: string | undefined;
    const write = async (tx: Prisma.TransactionClient, botId: string) => {
      await lockOwner(tx, actor.userId, "names:mcpServer");
      const bot = await tx.bot.findFirst({
        where: { id: botId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      });
      if (!bot) throw new ORPCError("CONFLICT", { message: "Project manager unavailable" });
      const scope = { spaceId: actor.spaceId, userId: actor.userId };
      const bySlug = await tx.mcpServer.findFirst({ where: { ...scope, slug: config.slug } });
      const byName = bySlug
        ? null
        : await tx.mcpServer.findFirst({ where: { ...scope, name: config.name } });
      // Names are display data: two projects can share one. Only adopt an unbound legacy name.
      const candidate = bySlug ?? (byName?.slug.startsWith("pm-") ? null : byName);
      if (candidate) {
        await lockMcpOAuthMaterial(tx, candidate.id);
        const existing = await tx.mcpServer.findFirst({
          where: { ...scope, id: candidate.id },
          include: { availableIn: { select: { spaceId: true } } },
        });
        if (!existing) throw new ORPCError("CONFLICT", { message: "Project manager unavailable" });
        // Re-mint even on reuse: a matching name alone cannot prove the credentials are scoped.
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
        if (existing.secretId)
          await tx.$queryRaw`SELECT id FROM secrets WHERE id = ${existing.secretId} FOR UPDATE`;
        await tx.secret.create({
          data: {
            id: stored.id,
            userId: actor.userId,
            spaceId: actor.spaceId,
            kind: "mcp",
            ciphertext: stored.ciphertext,
          },
        });
        server = await tx.mcpServer.update({
          where: { id: existing.id },
          data: {
            endpoint: "endpoint" in config ? config.endpoint : null,
            slug: config.slug,
            name: config.name,
            secretId: stored.id,
            headers: { Authorization: true },
            enabled: true,
            revision: { increment: 1 },
            healthStatus: "unknown",
            healthMessage: null,
            healthToolCount: null,
            healthCheckedAt: null,
          },
        });
        if (existing.secretId)
          await tx.secret.deleteMany({ where: { id: existing.secretId, ...itemSecretIn(actor) } });
      } else {
        server = await insertMcpServer(tx, actor, config, stored);
      }
      await tx.bot.update({ where: { id: botId }, data: { inheritMcpServers: false } });
      await tx.botMcpServer.deleteMany({ where: { botId, spaceId: actor.spaceId } });
      await tx.botMcpServer.create({
        data: {
          botId,
          serverId: server.id,
          spaceId: actor.spaceId,
          userId: actor.userId,
          allowAllTools: true,
          allowedTools: [],
        },
      });
      seededBotId = botId;
    };
    const spawnKey = `pm:${project.id}`;
    const existing = (await repos.listBots(actor)).find((bot) => bot.spawnKey === spawnKey);
    const bot =
      existing ??
      (await repos.createBot(actor, {
        name: `PM — ${project.name}`.slice(0, 80),
        spawnKey,
        description: "",
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
    return { bot, server: mcpServerDto(server), created };
  });
}
