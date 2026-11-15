import { randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeClientBinding, resolveClientBinding } from "./space-client-binding.js";

const postgres = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;
postgres("explicit Space binding (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  const userId = randomUUID();
  const organizationId = randomUUID();
  const spaceId = randomUUID();
  const externalClientId = randomUUID();
  const actor: Actor = { userId, spaceId, email: "binding@example.test", isDeploymentOwner: false };
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    system = asSystem(db.prisma);
    await system.user.create({
      data: { id: userId, name: "Binding fixture", email: `${userId}@example.test` },
    });
    await system.organization.create({
      data: {
        id: organizationId,
        name: "Binding fixture",
        slug: organizationId,
        createdAt: new Date(),
      },
    });
    await system.member.create({
      data: { id: randomUUID(), userId, organizationId, role: "owner", createdAt: new Date() },
    });
    // Previous-release create shape: no binding field or required relation.
    await system.space.create({
      data: { id: spaceId, name: "Original", organizationId, createdByUserId: userId },
    });
    await system.spaceMember.create({
      data: {
        id: randomUUID(),
        userId,
        organizationId,
        spaceId,
        role: "owner",
        createdAt: new Date(),
      },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await system.organization.deleteMany({ where: { id: organizationId } });
    await system.user.deleteMany({ where: { id: userId } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  const resolve = (revision?: number) =>
    runAsTenant(actor, () => resolveClientBinding(db.prisma, actor, revision));
  it("keeps previous-release Space writes compatible, persists authority across rename and cascades delete", async () => {
    await expect(resolve()).rejects.toThrow("binding_missing");
    const attempts = await Promise.allSettled([
      changeClientBinding(db.prisma, actor, {
        revision: 0,
        client: { id: externalClientId, name: "Verified snapshot" },
      }),
      changeClientBinding(db.prisma, actor, {
        revision: 0,
        client: { id: externalClientId, name: "Verified snapshot" },
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await resolve()).toHaveProperty("revision", 1);
    const duplicateSpaceId = randomUUID();
    await system.space.create({ data: { id: duplicateSpaceId, name: "Original", organizationId } });
    await expect(
      system.spaceClientBinding.create({
        data: { spaceId: duplicateSpaceId, externalClientId, clientName: "Same name", userId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // Previous-release rename shape; no relation updates required.
    await system.space.update({ where: { id: spaceId }, data: { name: "Another client" } });
    expect(await resolve()).toMatchObject({
      externalClientId,
      clientName: "Verified snapshot",
      revision: 1,
    });
    await expect(
      changeClientBinding(db.prisma, actor, {
        revision: 1,
        client: { id: "wrong", name: "Wrong" },
      }),
    ).rejects.toThrow("binding_exists");
    await expect(
      changeClientBinding(db.prisma, actor, { revision: 0, client: null }),
    ).rejects.toThrow("binding_stale");
    await system.spaceMember.update({
      where: { spaceId_userId: { spaceId, userId } },
      data: { role: "member" },
    });
    await expect(resolve()).resolves.toHaveProperty("externalClientId", externalClientId);
    await expect(
      changeClientBinding(
        db.prisma,
        { ...actor, isDeploymentOwner: true },
        { revision: 1, client: null },
      ),
    ).rejects.toThrow("forbidden");
    await system.spaceMember.update({
      where: { spaceId_userId: { spaceId, userId } },
      data: { role: "admin" },
    });
    const server = await system.mcpServer.create({
      data: {
        spaceId,
        userId,
        name: "Legacy project connection",
        slug: "pm-legacy",
        transport: "streamable_http",
        endpoint: "https://example.test/mcp",
      },
    });
    await expect(
      changeClientBinding(db.prisma, actor, { revision: 1, client: null }),
    ).rejects.toThrow("project_managers_exist");
    await system.mcpServer.delete({ where: { id: server.id } });
    const unbound = await changeClientBinding(db.prisma, actor, { revision: 1, client: null });
    expect(unbound).toMatchObject({ active: false, revision: 2 });
    await expect(resolve()).rejects.toThrow("binding_missing");
    await changeClientBinding(db.prisma, actor, {
      revision: 2,
      client: { id: externalClientId, name: "Snapshot" },
    });
    await expect(resolve(1)).rejects.toThrow("binding_stale");
    const events = await system.auditEvent.findMany({
      where: { spaceId, action: { startsWith: "space.client." } },
    });
    expect(events.map((event) => event.action).sort()).toEqual([
      "space.client.bound",
      "space.client.bound",
      "space.client.unbound",
    ]);
    await system.spaceMember.delete({ where: { spaceId_userId: { spaceId, userId } } });
    await expect(resolve()).rejects.toThrow("forbidden");
    await system.space.delete({ where: { id: spaceId } });
    expect(await system.spaceClientBinding.findUnique({ where: { spaceId } })).toBeNull();
  });
});
