import { availableInSpace } from "./availability.js";
import type { Prisma } from "./client.js";

/** Routes come from the recorded effect, never from a card or the client's answer. */
export function mcpApprovalRoute(request: unknown): { serverId: string; tool: string } | undefined {
  if (!Array.isArray(request) || request[0] !== "__rakazoCatalogTool") return undefined;
  const payload = request[1] === "direct" ? request[2]?.route : request[3];
  if (
    payload?.connectorId !== "mcp" ||
    typeof payload.resourceId !== "string" ||
    typeof payload.toolName !== "string"
  )
    return undefined;
  return { serverId: payload.resourceId, tool: payload.toolName };
}

/** Lock the assignment so simultaneous approvals cannot overwrite each other's grants. */
export async function trustMcpApproval(
  tx: Prisma.TransactionClient,
  scope: { spaceId: string; botId: string; userId: string },
  route: { serverId: string; tool: string },
): Promise<void> {
  const key = `mcp-trust:${scope.spaceId}:${scope.botId}:${route.serverId}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"`;
  let assignment = await tx.botMcpServer.findFirst({
    where: { ...scope, serverId: route.serverId },
  });
  if (!assignment) {
    const [bot, server] = await Promise.all([
      tx.bot.findFirst({
        where: { id: scope.botId, spaceId: scope.spaceId, inheritMcpServers: true },
      }),
      tx.mcpServer.findFirst({
        where: { id: route.serverId, enabled: true, allBots: true, ...availableInSpace(scope) },
      }),
    ]);
    if (!bot || !server) return;
    // Preserve the inherited availability, but pin trust to this bot and Space.
    assignment = await tx.botMcpServer.create({
      data: { ...scope, serverId: route.serverId, allowAllTools: true, allowedTools: [] },
    });
  }
  if (
    !assignment.allowAllTools &&
    !(Array.isArray(assignment.allowedTools) && assignment.allowedTools.includes(route.tool))
  )
    return;
  const tools = Array.isArray(assignment.trustedTools)
    ? assignment.trustedTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  await tx.botMcpServer.update({
    where: { id: assignment.id },
    data: { trustedTools: [...new Set([...tools, route.tool])] },
  });
}
