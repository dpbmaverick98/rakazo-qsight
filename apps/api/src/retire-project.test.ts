import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import { retireProject } from "./retire-project.js";

vi.mock("./routes/shared.js", () => ({ computerContext: vi.fn() }));
vi.mock("@rakazo/db", () => ({ runAsSystem: (_reason: string, fn: () => unknown) => fn() }));
vi.mock("./space-client-binding.js", () => ({
  bindingAccess: vi.fn(),
  resolveClientBinding: vi.fn(),
}));
const actor = { userId: "admin", spaceId: "space" } as Actor;
function setup(shared = false) {
  const bots = [
    { id: "pm", userId: "creator", spaceId: "space", spawnKey: "pm:roof", archivedAt: null },
    { id: "other", spawnKey: "pm:other" },
    { id: "setup", spawnKey: "setup:client" },
  ];
  const server = {
    id: "server",
    secretId: "secret",
    managedCredentialId: "issued",
    allBots: shared,
    allSpaces: false,
  };
  const tx = {
    bot: {
      findMany: vi.fn(async ({ where }) => bots.filter((bot) => bot.spawnKey === where.spawnKey)),
      updateMany: vi.fn(),
    },
    mcpServer: { findMany: vi.fn(async () => [server]), updateMany: vi.fn(), update: vi.fn() },
    botMcpServer: { count: vi.fn(async () => 0), deleteMany: vi.fn() },
    chatGroupMember: { deleteMany: vi.fn() },
    secret: { deleteMany: vi.fn() },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
  const archive = vi.fn<Parameters<typeof retireProject>[0]["archive"]>(async () => {});
  const revokeManagerToken = vi.fn(async () => {});
  const deps = { prisma, archive, revokeManagerToken } as unknown as Parameters<
    typeof retireProject
  >[0];
  return { tx, bots, deps, archive, revokeManagerToken };
}
it("archives only the project's PM, revokes credentials and removes roster assignments while retaining history", async () => {
  const { tx, bots, deps, archive, revokeManagerToken } = setup();
  await retireProject(deps, actor, "roof", 1);
  expect(archive).toHaveBeenCalledTimes(1);
  expect(archive.mock.calls[0]?.[1]).toBe(bots[0]);
  expect(revokeManagerToken).toHaveBeenCalledWith("issued");
  expect(tx.mcpServer.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["server"] }, spaceId: "space" },
    data: { enabled: false },
  });
  expect(tx.botMcpServer.deleteMany).toHaveBeenCalledWith({
    where: { spaceId: "space", botId: { in: ["pm"] } },
  });
  expect(tx.chatGroupMember.deleteMany).toHaveBeenCalledWith({
    where: { spaceId: "space", botId: { in: ["pm"] } },
  });
  expect(tx.mcpServer.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        managedCredentialId: null,
        secretId: null,
        headers: {},
        enabled: false,
      }),
    }),
  );
  expect(tx.bot.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ spawnKey: null, sectionId: null }) }),
  );
  expect(tx.secret.deleteMany).toHaveBeenCalledWith({ where: { id: "secret", spaceId: "space" } });
});
it("refuses shared managed credentials before archiving or revoking another project's access", async () => {
  const { deps, archive, revokeManagerToken, tx } = setup(true);
  await expect(retireProject(deps, actor, "roof", 1)).rejects.toThrow("requires repair");
  expect(archive).not.toHaveBeenCalled();
  expect(revokeManagerToken).not.toHaveBeenCalled();
  expect(tx.mcpServer.updateMany).not.toHaveBeenCalled();
});
