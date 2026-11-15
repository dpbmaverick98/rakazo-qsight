import { randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import { PROJECT_MANAGER_TOOLS } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, createSpaceForMember, runAsSystem, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupClient } from "./client-setup.js";
import { changeClientBinding } from "./space-client-binding.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

describePostgres("canonical client setup (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let actor: Actor;
  const id = randomUUID();
  const client = { id: `client-${id}`, name: "Example Client" };
  const source = {
    findClient: vi.fn(async () => client as typeof client | null),
    createClient: vi.fn(async () => client as typeof client | null),
  };
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    system = asSystem(db.prisma);
    const createdAt = new Date();
    await system.user.create({
      data: { id, name: "Test Owner", email: `${id}@example.test`, emailVerified: true },
    });
    await system.organization.create({ data: { id, name: "Personal", slug: id, createdAt } });
    await system.member.create({
      data: { id, organizationId: id, userId: id, role: "owner", createdAt },
    });
    await system.space.create({
      data: { id, organizationId: id, name: "Personal", isDefault: true, createdByUserId: id },
    });
    await system.spaceMember.create({
      data: { id, spaceId: id, organizationId: id, userId: id, role: "owner", createdAt },
    });
    actor = { userId: id, spaceId: id, email: `${id}@example.test`, isDeploymentOwner: false };
  });
  afterAll(async () => {
    if (!system) return;
    await system.organization.deleteMany({ where: { id } });
    await system.user.deleteMany({ where: { id } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("recovers an upstream 409, keeps one PM on concurrent retries, and resumes when MCP is added", async () => {
    // Equal names alone never authorize or select a Space.
    const unrelated = await runAsSystem("fixture", () =>
      createSpaceForMember(db.prisma, { currentSpaceId: id, userId: id, name: client.name }),
    );
    source.findClient.mockResolvedValueOnce(null);
    source.createClient.mockResolvedValueOnce(null);
    const [missing, concurrent] = await Promise.all([
      setupClient(db.prisma, actor, source, client.name),
      setupClient(db.prisma, actor, source, client.name),
    ]);
    expect(concurrent).toEqual(missing);
    expect(source.createClient).toHaveBeenCalledOnce();
    expect(missing.status).toBe("mcp_missing");
    expect(missing.spaceId).not.toBe(unrelated.id);
    expect(
      await system.spaceClientBinding.findUnique({ where: { spaceId: missing.spaceId } }),
    ).toMatchObject({ externalClientId: client.id, active: true, userId: id });
    const repeated = await Promise.all([
      setupClient(db.prisma, actor, source, client.name),
      setupClient(db.prisma, actor, source, client.name),
    ]);
    expect(repeated).toEqual([missing, missing]);
    expect(await system.bot.count({ where: { spaceId: missing.spaceId } })).toBe(1);
    expect(await system.bot.findUnique({ where: { id: missing.botId } })).toMatchObject({
      name: "PM",
      spawnKey: `setup:${client.id}`,
      inheritMcpServers: false,
      crossSpaceCommunication: false,
    });
    expect(await system.mcpServer.count({ where: { userId: id } })).toBe(0);
    const secret = await system.secret.create({
      data: { spaceId: id, userId: id, kind: "mcp", ciphertext: "fake-encrypted-reference" },
    });
    const server = await system.mcpServer.create({
      data: {
        spaceId: id,
        userId: id,
        slug: "setup-tools",
        name: PROJECT_MANAGER_TOOLS.legacyServerName,
        transport: "streamable_http",
        endpoint: "https://tools.example.test/mcp",
        allBots: true,
        secretId: secret.id,
      },
    });
    const ready = await setupClient(db.prisma, actor, source, client.name);
    expect(ready).toEqual({ ...missing, serverId: server.id, status: "ready" });
    expect(await setupClient(db.prisma, actor, source, client.name)).toEqual(ready);
    expect(await system.mcpServer.findUnique({ where: { id: server.id } })).toMatchObject({
      allBots: false,
      secretId: secret.id,
    });
    expect(await system.secret.findUnique({ where: { id: secret.id } })).toMatchObject({
      spaceId: null,
      ciphertext: "fake-encrypted-reference",
    });
    expect(await system.secret.count({ where: { userId: id } })).toBe(1);
    expect(await system.botMcpServer.findMany({ where: { serverId: server.id } })).toMatchObject([
      {
        botId: missing.botId,
        userId: id,
        spaceId: missing.spaceId,
        allowAllTools: false,
        trustedTools: [...PROJECT_MANAGER_TOOLS.trustedTools],
      },
    ]);
    expect(
      await runAsTenant({ ...actor, spaceId: missing.spaceId }, () =>
        db.prisma.mcpServer.findFirst({ where: { id: server.id } }),
      ),
    ).not.toBeNull();
    await expect(
      changeClientBinding(
        db.prisma,
        { ...actor, spaceId: missing.spaceId },
        { revision: 1, client: null },
      ),
    ).rejects.toMatchObject({ message: "project_managers_exist" });
    // A completed promotion must not let a setup retry restore broad owner tools.
    await system.bot.update({
      where: { id: missing.botId },
      data: { spawnKey: "pm:synthetic-project" },
    });
    await system.botMcpServer.deleteMany({ where: { botId: missing.botId } });
    await expect(setupClient(db.prisma, actor, source, client.name)).rejects.toMatchObject({
      message: "setup_finished",
    });
    expect(await system.bot.count({ where: { spaceId: missing.spaceId } })).toBe(1);
    expect(await system.botMcpServer.count({ where: { botId: missing.botId } })).toBe(0);
  });

  it("rejects inactive bindings and member-only access even for deployment owners", async () => {
    const binding = await system.spaceClientBinding.findUniqueOrThrow({
      where: { externalClientId: client.id },
    });
    await system.spaceMember.update({
      where: { spaceId_userId: { spaceId: binding.spaceId, userId: id } },
      data: { role: "member" },
    });
    await expect(
      setupClient(db.prisma, { ...actor, isDeploymentOwner: true }, source, client.name),
    ).rejects.toMatchObject({ message: "binding_conflict" });
    await system.spaceMember.update({
      where: { spaceId_userId: { spaceId: binding.spaceId, userId: id } },
      data: { role: "owner" },
    });
    await system.spaceClientBinding.update({
      where: { spaceId: binding.spaceId },
      data: { active: false },
    });
    await expect(setupClient(db.prisma, actor, source, client.name)).rejects.toMatchObject({
      message: "binding_conflict",
    });
  });
});
