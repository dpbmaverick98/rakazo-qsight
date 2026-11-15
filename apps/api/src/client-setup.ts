import { ORPCError } from "@orpc/server";
import { lockMcpOAuthMaterial } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { ClientSetup } from "@rakazo/contracts/hierarchy";
import { CreateClientSchema } from "@rakazo/contracts/hierarchy";
import { PROJECT_MANAGER_TOOLS } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import {
  ClientSpaceConflictError,
  createRepos,
  createSpaceForMember,
  isUniqueViolation,
  lockSpaceDeletion,
  runAsSystem,
  runAsSystemInTransaction,
  runAsTenant,
} from "@rakazo/db";
import { lockOwner, makeServerAvailableInSpace } from "./availability.js";
import { clientSetupInstructions } from "./client-setup.prompt.js";
import { bindingAccess, resolveClientBinding } from "./space-client-binding.js";

type Client = { id: string; name: string };
export type ClientSetupSource = {
  findClient: (name: string) => Promise<Client | null>;
  createClient: (name: string) => Promise<Client | null>;
};

/** External writes finish before local transactions. Retrying the same name repairs partial setup. */
export async function setupClient(
  prisma: PrismaClient,
  actor: Actor,
  source: ClientSetupSource,
  name: string,
): Promise<ClientSetup> {
  const input = CreateClientSchema.parse({ name });
  const client =
    (await source.findClient(input.name)) ??
    (await source.createClient(input.name)) ??
    (await source.findClient(input.name));
  if (!client) throw new ORPCError("CONFLICT", { message: "client_conflict" });
  if (client.name !== input.name)
    throw new ORPCError("BAD_GATEWAY", { message: "binding_mismatch" });
  const space = await runAsSystem(
    "create or resume an explicitly bound client Space for its member",
    () =>
      createSpaceForMember(prisma, {
        currentSpaceId: actor.spaceId,
        userId: actor.userId,
        name: input.name,
        client,
      }),
  ).catch((error) => {
    if (error instanceof ClientSpaceConflictError || isUniqueViolation(error))
      throw new ORPCError("CONFLICT", { message: "binding_conflict" });
    throw error;
  });
  const target = { ...actor, spaceId: space.id };
  return runAsTenant(target, async () => {
    await bindingAccess(prisma, target, true);
    const binding = await resolveClientBinding(prisma, target);
    if (binding.externalClientId !== client.id)
      throw new ORPCError("CONFLICT", { message: "binding_stale" });
    const repos = createRepos(prisma);
    if (
      await prisma.bot.findFirst({
        where: { spaceId: target.spaceId, spawnKey: { startsWith: "pm:" } },
      })
    )
      throw new ORPCError("CONFLICT", { message: "setup_finished" });
    const spawnKey = `setup:${client.id}`;
    // Resume the setup PM for any current Space owner/admin, not only its creator.
    const existing = await prisma.bot.findFirst({
      where: { spaceId: target.spaceId, spawnKey },
      select: { id: true, name: true, spawnKey: true, userId: true, archivedAt: true },
    });
    if (existing?.archivedAt) throw new ORPCError("CONFLICT", { message: "setup_archived" });
    const bot =
      existing ??
      (await repos
        .createBot(target, {
          name: "PM",
          spawnKey,
          replaceArchived: false,
          description: "",
          instructions: clientSetupInstructions(client),
          notifyOnFinish: false,
          dailyCheckIns: false,
          fleetManagement: false,
          seed: async (tx, botId) => {
            await lockSpaceDeletion(tx, target.spaceId);
            await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${target.spaceId} FOR UPDATE`;
            if (
              await tx.bot.findFirst({
                where: {
                  spaceId: target.spaceId,
                  spawnKey: { startsWith: "pm:" },
                },
              })
            )
              throw new ORPCError("CONFLICT", { message: "setup_finished" });
            await bindingAccess(tx, target, true);
            await resolveClientBinding(tx, target, binding.revision);
            await tx.bot.update({
              where: { id: botId },
              data: { inheritMcpServers: false, crossSpaceCommunication: false },
            });
          },
        })
        .catch((error) => {
          if (isUniqueViolation(error))
            throw new ORPCError("CONFLICT", { message: "setup_unavailable" });
          throw error;
        }));
    const serverId = await prisma.$transaction(async (tx) => {
      await lockSpaceDeletion(tx, target.spaceId);
      await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${target.spaceId} FOR UPDATE`;
      await bindingAccess(tx, target, true);
      await resolveClientBinding(tx, target, binding.revision);
      if (
        await tx.bot.findFirst({
          where: { spaceId: target.spaceId, spawnKey: { startsWith: "pm:" } },
        })
      )
        throw new ORPCError("CONFLICT", { message: "setup_finished" });
      const current = await tx.bot.findFirst({
        where: { id: bot.id, spaceId: target.spaceId, archivedAt: null },
      });
      if (!current) throw new ORPCError("CONFLICT", { message: "setup_unavailable" });
      await tx.bot.update({
        where: { id: bot.id },
        data: { inheritMcpServers: false, crossSpaceCommunication: false },
      });
      return runAsSystemInTransaction(
        tx,
        "attach only the signed-in owner's existing setup connection",
        async () => {
          await lockOwner(tx, target.userId, "names:mcpServer");
          const servers = await tx.mcpServer.findMany({
            where: {
              userId: target.userId,
              enabled: true,
              name: {
                in: [PROJECT_MANAGER_TOOLS.serverName, PROJECT_MANAGER_TOOLS.legacyServerName],
              },
              space: { deletingAt: null, memberships: { some: { userId: target.userId } } },
            },
            include: { availableIn: { select: { spaceId: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          const candidate =
            servers.find((item) => item.name === PROJECT_MANAGER_TOOLS.serverName) ?? servers[0];
          await tx.botMcpServer.deleteMany({
            where: { botId: bot.id, spaceId: target.spaceId, userId: target.userId },
          });
          if (!candidate) return null;
          await lockMcpOAuthMaterial(tx, candidate.id);
          const server = await tx.mcpServer.findFirst({
            where: { id: candidate.id, userId: target.userId, enabled: true },
            include: { availableIn: { select: { spaceId: true } } },
          });
          if (!server) return null;
          // TEMPORARY broad owner access. Phase 3 replaces this assignment with project-scoped credentials.
          await makeServerAvailableInSpace(tx, target, server);
          await tx.mcpServer.update({
            where: { id: server.id },
            data: { allBots: false, revision: { increment: 1 } },
          });

          await tx.botMcpServer.create({
            data: {
              botId: bot.id,
              serverId: server.id,
              spaceId: target.spaceId,
              userId: target.userId,
              allowAllTools: true,
              allowedTools: [],
            },
          });
          return server.id;
        },
      );
    });
    return {
      clientId: client.id,
      spaceId: space.id,
      botId: bot.id,
      serverId,
      status: serverId ? "ready" : "mcp_missing",
    };
  });
}
