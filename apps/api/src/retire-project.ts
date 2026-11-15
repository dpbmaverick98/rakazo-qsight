import { ORPCError } from "@orpc/server";
import type { archiveBot } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { retry } from "@rakazo/core";
import { runAsSystem, runAsSystemInTransaction } from "@rakazo/db";
import { computerContext } from "./routes/shared.js";
import { bindingAccess, resolveClientBinding } from "./space-client-binding.js";

type Lifecycle = Parameters<typeof archiveBot>[0];

/** Preserve bot/thread records. Only the canonical project's managed connections are retired. */
export async function retireProject(
  deps: Lifecycle & {
    archive: typeof archiveBot;
    revokeManagerToken: (id: string) => Promise<void>;
    managerConnectionKey: (projectId: string) => string;
  },
  actor: Actor,
  projectId: string,
  revision: number,
) {
  await bindingAccess(deps.prisma, actor, true);
  await resolveClientBinding(deps.prisma, actor, revision);
  // Space admins may retire PMs created by another member; never widen the project scope.
  return runAsSystem("retire the bound project's managers across member owners", async () => {
    const bots = await deps.prisma.bot.findMany({
      where: { spaceId: actor.spaceId, spawnKey: `pm:${projectId}` },
    });
    const ids = bots.map((bot) => bot.id);
    const servers = await deps.prisma.mcpServer.findMany({
      where: {
        spaceId: actor.spaceId,
        managedCredentialId: { not: null },
        OR: [
          { slug: deps.managerConnectionKey(projectId) },
          { assignments: { some: { botId: { in: ids } } } },
        ],
      },
    });
    for (const server of servers) {
      const shared =
        server.allBots ||
        server.allSpaces ||
        (await deps.prisma.botMcpServer.count({
          where: { serverId: server.id, botId: { notIn: ids } },
        }));
      if (shared)
        throw new ORPCError("CONFLICT", { message: "Project manager connection requires repair" });
    }
    // Disable locally first, including on a failed or interrupted upstream revocation.
    await deps.prisma.mcpServer.updateMany({
      where: { id: { in: servers.map((server) => server.id) }, spaceId: actor.spaceId },
      data: { enabled: false },
    });
    for (const bot of bots) {
      await deps.archive(
        deps,
        bot,
        computerContext({ ...actor, userId: bot.userId }, bot.id, "archive"),
      );
    }
    for (const server of servers) {
      await retry(() => deps.revokeManagerToken(server.managedCredentialId!), {
        attempts: 3,
        delayMs: [100, 500],
        retryable: () => true,
      });
    }
    await deps.prisma.$transaction(async (tx) => {
      await bindingAccess(tx, actor, true);
      await resolveClientBinding(tx, actor, revision);
      await tx.botMcpServer.deleteMany({ where: { spaceId: actor.spaceId, botId: { in: ids } } });
      await tx.chatGroupMember.deleteMany({
        where: { spaceId: actor.spaceId, botId: { in: ids } },
      });
      await tx.bot.updateMany({
        where: { spaceId: actor.spaceId, id: { in: ids } },
        data: {
          spawnKey: null,
          sectionId: null,
          inheritMcpServers: false,
          crossSpaceCommunication: false,
        },
      });
      for (const server of servers) {
        await tx.mcpServer.deleteMany({ where: { id: server.id, spaceId: actor.spaceId } });
        if (server.secretId)
          await tx.secret.deleteMany({ where: { id: server.secretId, spaceId: actor.spaceId } });
      }
    });
  });
}

export async function auditProjectMutation(
  prisma: Lifecycle["prisma"],
  actor: Actor,
  projectId: string,
  action: "rename" | "delete",
) {
  await prisma.$transaction(async (tx) => {
    const space = await bindingAccess(tx, actor, true);
    await runAsSystemInTransaction(tx, "audit authorized project mutation", () =>
      tx.auditEvent.create({
        data: {
          organizationId: space.organizationId,
          spaceId: actor.spaceId,
          actorType: "user",
          actorId: actor.userId,
          action: `project.${action}`,
          outcome: "success",
          targetType: "project",
          targetId: projectId,
        },
      }),
    );
  });
}
