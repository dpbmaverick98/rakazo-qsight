import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import type { Prisma, PrismaClient } from "@rakazo/db";
import {
  isUniqueViolation,
  lockSpaceDeletion,
  runAsSystemInTransaction,
  runAsTenant,
} from "@rakazo/db";

type Db = Pick<Prisma.TransactionClient, "space" | "spaceMember" | "spaceClientBinding">;
export type ClientBinding = { externalClientId: string; clientName: string; revision: number };

export async function bindingAccess(db: Db, actor: Actor, manage = false) {
  const membership = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
  });
  if (!membership) throw new ORPCError("FORBIDDEN", { message: "forbidden" });
  const roles = membership.role.split(",").map((role) => role.trim());
  if (manage && !roles.some((role) => role === "owner" || role === "admin"))
    throw new ORPCError("FORBIDDEN", { message: "forbidden" });
  const space = await db.space.findUnique({ where: { id: actor.spaceId } });
  if (!space || space.deletingAt) throw new ORPCError("CONFLICT", { message: "space_unavailable" });
  if (space.isDefault) throw new ORPCError("CONFLICT", { message: "personal" });
  return space;
}

/** Capability probe; mutation paths must still enforce bindingAccess with manage=true. */
export async function canManageClientBinding(db: Db, actor: Actor): Promise<boolean> {
  try {
    await bindingAccess(db, actor, true);
    return true;
  } catch (error) {
    if (error instanceof ORPCError && error.code === "FORBIDDEN") return false;
    throw error;
  }
}

export async function resolveClientBinding(
  db: Db,
  actor: Actor,
  revision?: number,
): Promise<ClientBinding> {
  await bindingAccess(db, actor);
  const binding = await db.spaceClientBinding.findUnique({ where: { spaceId: actor.spaceId } });
  if (!binding?.active) throw new ORPCError("CONFLICT", { message: "binding_missing" });
  if (revision !== undefined && revision !== binding.revision)
    throw new ORPCError("CONFLICT", { message: "binding_stale" });
  return binding;
}

/** Fresh canonical ID reads only; recheck access/revision after the external request. */
export async function boundHierarchy(
  db: Db,
  actor: Actor,
  source: { read: (id: string, fresh?: boolean) => Promise<Hierarchy> },
  revision?: number,
) {
  const binding = await resolveClientBinding(db, actor, revision);
  const hierarchy = await source.read(binding.externalClientId, true);
  if (hierarchy.client.id !== binding.externalClientId)
    throw new ORPCError("BAD_GATEWAY", { message: "binding_mismatch" });
  await resolveClientBinding(db, actor, binding.revision);
  return { binding, hierarchy };
}

/** No external HTTP under the lock. Tombstones retain revisions across unbind/rebind. */
export async function changeClientBinding(
  db: PrismaClient,
  actor: Actor,
  input: { revision: number; client: { id: string; name: string } | null },
) {
  return runAsTenant(actor, () =>
    db.$transaction(async (tx) => {
      await lockSpaceDeletion(tx, actor.spaceId);
      await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${actor.spaceId} FOR UPDATE`;
      const space = await bindingAccess(tx, actor, true);
      const current = await tx.spaceClientBinding.findUnique({ where: { spaceId: actor.spaceId } });
      if ((current?.revision ?? 0) !== input.revision)
        throw new ORPCError("CONFLICT", { message: "binding_stale" });
      if (current?.active && input.client)
        throw new ORPCError("CONFLICT", { message: "binding_exists" });
      // Existing scoped credentials must be removed deliberately before changing authority.
      const hasManagers = await runAsSystemInTransaction(
        tx,
        "check all scoped project credentials before binding change",
        async () =>
          (await tx.bot.count({
            where: {
              spaceId: actor.spaceId,
              OR: [{ spawnKey: { startsWith: "pm:" } }, { spawnKey: { startsWith: "setup:" } }],
            },
          })) > 0 ||
          (await tx.mcpServer.count({
            where: { spaceId: actor.spaceId, slug: { startsWith: "pm-" } },
          })) > 0,
      );
      if (hasManagers) throw new ORPCError("CONFLICT", { message: "project_managers_exist" });
      const snapshot =
        input.client ??
        (current ? { id: current.externalClientId, name: current.clientName } : null);
      if (!snapshot) throw new ORPCError("CONFLICT", { message: "binding_missing" });
      const binding = await tx.spaceClientBinding.upsert({
        where: { spaceId: actor.spaceId },
        create: {
          spaceId: actor.spaceId,
          externalClientId: snapshot.id,
          clientName: snapshot.name,
          userId: actor.userId,
        },
        update: {
          ...(input.client
            ? { externalClientId: input.client.id, clientName: input.client.name }
            : {}),
          active: input.client !== null,
          userId: actor.userId,
          revision: { increment: 1 },
        },
      });
      await runAsSystemInTransaction(tx, "audit explicit Space client binding change", () =>
        tx.auditEvent.create({
          data: {
            organizationId: space.organizationId,
            spaceId: actor.spaceId,
            actorType: "user",
            actorId: actor.userId,
            action: input.client ? "space.client.bound" : "space.client.unbound",
            outcome: "success",
            targetType: "space",
            targetId: actor.spaceId,
            metadata: { revision: binding.revision, externalClientId: binding.externalClientId },
          },
        }),
      );
      return binding;
    }),
  ).catch((error) => {
    if (isUniqueViolation(error)) throw new ORPCError("CONFLICT", { message: "binding_conflict" });
    throw error;
  });
}
