import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { CreatedBuilding } from "@rakazo/contracts/hierarchy";
import type { PrismaClient } from "@rakazo/db";
import { createRepos, lockSpaceDeletion } from "@rakazo/db";
import { buildingManagerInstructions } from "./building-manager.prompt.js";
import type { RouterDeps } from "./router.js";
import { bindingAccess, boundHierarchy, resolveClientBinding } from "./space-client-binding.js";

/** Building setup uses the same spawn-key creation and promotion path as project PMs. */
export async function provisionBuildingManager(
  prisma: PrismaClient,
  actor: Actor,
  source: NonNullable<RouterDeps["projectManagers"]>,
  building: CreatedBuilding,
  revision: number,
) {
  await bindingAccess(prisma, actor, true);
  const { hierarchy } = await boundHierarchy(prisma, actor, source, revision);
  const current = hierarchy.buildings.find((item) => item.id === building.id);
  if (!current) throw new ORPCError("NOT_FOUND", { message: "Building unavailable" });
  const repos = createRepos(prisma);
  const bots = await repos.listBots(actor);
  const existing = bots.find(
    (bot) =>
      bot.spawnKey === `building:${building.id}` ||
      current.projects.some((project) => bot.spawnKey === `pm:${project.id}`),
  );
  if (existing) return existing.id;
  const bot = await repos.createBot(actor, {
    name: "Proj. Manager - Sam",
    spawnKey: `building:${building.id}`,
    description: "",
    instructions: buildingManagerInstructions(current, hierarchy.client.name),
    notifyOnFinish: false,
    dailyCheckIns: false,
    fleetManagement: false,
    initialMessage: {
      role: "bot",
      blocks: [{ kind: "text", text: "What is the project name and scope for this building?" }],
    },
    seed: async (tx, botId) => {
      await lockSpaceDeletion(tx, actor.spaceId);
      await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${actor.spaceId} FOR UPDATE`;
      await bindingAccess(tx, actor, true);
      await resolveClientBinding(tx, actor, revision);
      await tx.bot.update({
        where: { id: botId },
        data: { inheritMcpServers: false, crossSpaceCommunication: false },
      });
    },
  });
  return bot.id;
}
