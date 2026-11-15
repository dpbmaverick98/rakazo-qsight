import { expect, it, vi } from "vitest";
import { answerRunInput } from "./thread-ask.js";

it.each(["allow", "always", "deny"])(
  "MCP %s answers preserve the recorded request and scope",
  async (answer) => {
    const request = [
      "__rakazoCatalogTool",
      "direct",
      {
        route: { connectorId: "mcp", resourceId: "server", toolName: "create_project" },
        args: { name: "Lobby", verification_token: "fake-token" },
      },
    ];
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "thread" }]),
      message: {
        findFirst: vi.fn(async () => ({
          id: "message",
          blocks: [
            {
              kind: "ask",
              approvalEffectId: "effect",
              text: "Create project?",
              status: "pending",
              actions: [
                { id: "allow", label: "Allow once" },
                { id: "always", label: "Always allow this action" },
                { id: "deny", label: "Deny" },
              ],
            },
          ],
        })),
        update: vi.fn(),
      },
      run: {
        findFirst: vi.fn(async () => ({ botId: "bot", userId: "owner" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({ userId: "owner", status: "queued" })),
      },
      externalEffect: {
        findFirst: vi.fn(async () => ({
          id: "effect",
          status: "intended",
          kind: "mcp__example__create_project",
          request,
        })),
        update: vi.fn(),
      },
      botMcpServer: {
        findFirst: vi.fn(async () => ({
          id: "assignment",
          allowAllTools: false,
          allowedTools: ["create_project"],
          trustedTools: [],
        })),
        update: vi.fn(),
      },
      userActionApprovalRule: { upsert: vi.fn() },
      actionApprovalRule: { upsert: vi.fn() },
      thread: { update: vi.fn(async () => ({ nextEventSeq: 2 })) },
      event: { create: vi.fn(async () => ({ seq: 1 })) },
    };
    const prisma = { $transaction: vi.fn(async (fn: (db: typeof tx) => unknown) => fn(tx)) };
    expect(
      await answerRunInput(prisma as never, {
        spaceId: "space",
        threadId: "thread",
        runId: "run",
        messageId: "message",
        answeredByUserId: "owner",
        answer,
      }),
    ).toBe(true);
    expect(tx.externalEffect.update).toHaveBeenCalledWith({
      where: { id: "effect" },
      data: { status: answer === "deny" ? "denied" : "approved" },
    });
    expect(tx.userActionApprovalRule.upsert).not.toHaveBeenCalled();
    expect(tx.actionApprovalRule.upsert).not.toHaveBeenCalled();
    if (answer === "always") {
      expect(tx.botMcpServer.findFirst).toHaveBeenCalledWith({
        where: { botId: "bot", spaceId: "space", userId: "owner", serverId: "server" },
      });
      expect(tx.botMcpServer.update).toHaveBeenCalledWith({
        where: { id: "assignment" },
        data: { trustedTools: ["create_project"] },
      });
    } else expect(tx.botMcpServer.update).not.toHaveBeenCalled();
    expect(request[2]).toMatchObject({ args: { verification_token: "fake-token" } });
  },
);
