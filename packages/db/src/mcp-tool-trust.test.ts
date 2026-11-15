import { describe, expect, it, vi } from "vitest";
import { mcpApprovalRoute, trustMcpApproval } from "./mcp-tool-trust.js";

describe("MCP assignment trust", () => {
  const route = { connectorId: "mcp", resourceId: "server", toolName: "create_project" };
  const scope = { botId: "bot", spaceId: "space", userId: "owner" };

  it("uses the recorded server and tool for direct and catalog approvals", () => {
    for (const request of [
      ["__rakazoCatalogTool", "direct", { route, args: {} }],
      ["__rakazoCatalogTool", "mcp_execute_tool", {}, route],
    ])
      expect(mcpApprovalRoute(request)).toEqual({ serverId: "server", tool: "create_project" });
    expect(mcpApprovalRoute({ serverId: "forged" })).toBeUndefined();
    expect(mcpApprovalRoute(["untrusted", "direct", { route }])).toBeUndefined();
    expect(
      mcpApprovalRoute([
        "__rakazoCatalogTool",
        "direct",
        {
          route: { ...route, connectorId: "other" },
        },
      ]),
    ).toBeUndefined();
  });

  it("locks and persists only the exact owner, space, bot and server assignment", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      botMcpServer: {
        findFirst: vi.fn(async () => ({
          id: "assignment",
          allowAllTools: false,
          allowedTools: ["search_clients", "create_project"],
          trustedTools: ["search_clients"],
        })),
        update: vi.fn(),
      },
    };
    await trustMcpApproval(tx as never, scope, { serverId: "server", tool: "create_project" });
    expect(tx.botMcpServer.findFirst).toHaveBeenCalledWith({
      where: { ...scope, serverId: "server" },
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.botMcpServer.update).toHaveBeenCalledWith({
      where: { id: "assignment" },
      data: { trustedTools: ["search_clients", "create_project"] },
    });
    await trustMcpApproval(tx as never, scope, { serverId: "server", tool: "unknown" });
    expect(tx.botMcpServer.update).toHaveBeenCalledTimes(1);
  });

  it("does not create a grant after an assignment was removed", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      botMcpServer: { findFirst: vi.fn(async () => null), update: vi.fn() },
      bot: { findFirst: vi.fn(async () => null) },
      mcpServer: { findFirst: vi.fn(async () => null) },
    };
    await trustMcpApproval(tx as never, scope, { serverId: "server", tool: "create_project" });
    expect(tx.botMcpServer.update).not.toHaveBeenCalled();
  });
});

it("pins an inherited server's grant to one bot without changing its tool availability", async () => {
  const tx = {
    $queryRaw: vi.fn(),
    bot: { findFirst: vi.fn(async () => ({ id: "bot" })) },
    mcpServer: { findFirst: vi.fn(async () => ({ id: "server" })) },
    botMcpServer: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({
        id: "assignment",
        allowAllTools: true,
        allowedTools: [],
        trustedTools: [],
      })),
      update: vi.fn(),
    },
  };
  await trustMcpApproval(
    tx as never,
    {
      botId: "bot",
      spaceId: "space",
      userId: "owner",
    },
    { serverId: "server", tool: "create_project" },
  );
  expect(tx.botMcpServer.create).toHaveBeenCalledWith({
    data: {
      botId: "bot",
      spaceId: "space",
      userId: "owner",
      serverId: "server",
      allowAllTools: true,
      allowedTools: [],
    },
  });
  expect(tx.botMcpServer.update).toHaveBeenCalledWith({
    where: { id: "assignment" },
    data: { trustedTools: ["create_project"] },
  });
});
