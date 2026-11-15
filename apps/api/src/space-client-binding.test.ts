import type { Prisma } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import { bindingAccess, boundHierarchy, resolveClientBinding } from "./space-client-binding.js";

const actor = {
  userId: "user",
  spaceId: "space",
  email: "user@example.test",
  isDeploymentOwner: true,
};
function setup() {
  const space = { id: "space", name: "First", isDefault: false, deletingAt: null };
  const binding = {
    externalClientId: "client-7",
    clientName: "Snapshot",
    revision: 3,
    active: true,
  };
  const db = {
    space: { findUnique: vi.fn(async () => space) },
    spaceMember: { findUnique: vi.fn(async () => ({ role: "owner" })) },
    spaceClientBinding: { findUnique: vi.fn(async () => binding) },
  };
  return { db, space, binding, typed: db as unknown as Prisma.TransactionClient };
}
it("renaming a Space cannot change the resolved external client", async () => {
  const { typed, space } = setup();
  expect((await resolveClientBinding(typed, actor)).externalClientId).toBe("client-7");
  space.name = "Another client with the same display name";
  expect((await resolveClientBinding(typed, actor)).externalClientId).toBe("client-7");
});
it("members read, owners and admins manage, deployment ownership never bypasses membership", async () => {
  const { db, typed } = setup();
  for (const role of ["owner", "admin", "member"]) {
    db.spaceMember.findUnique.mockResolvedValue({ role });
    await expect(resolveClientBinding(typed, actor)).resolves.toHaveProperty("revision", 3);
    if (role === "member")
      await expect(bindingAccess(typed, actor, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    else await expect(bindingAccess(typed, actor, true)).resolves.toHaveProperty("id", "space");
  }
  db.spaceMember.findUnique.mockResolvedValue(null as never);
  await expect(resolveClientBinding(typed, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("missing, inactive, stale, Personal and deleting Spaces fail closed", async () => {
  const { db, typed, binding, space } = setup();
  await expect(resolveClientBinding(typed, actor, 2)).rejects.toThrow("binding_stale");
  binding.active = false;
  await expect(resolveClientBinding(typed, actor)).rejects.toThrow("binding_missing");
  binding.active = true;
  space.isDefault = true;
  await expect(resolveClientBinding(typed, actor)).rejects.toThrow("personal");
  space.isDefault = false;
  space.deletingAt = new Date() as never;
  await expect(resolveClientBinding(typed, actor)).rejects.toThrow("space_unavailable");
  space.deletingAt = null;
  db.spaceClientBinding.findUnique.mockResolvedValue(null as never);
  await expect(resolveClientBinding(typed, actor)).rejects.toThrow("binding_missing");
});
it("checks identity and rechecks membership and revision after external reads", async () => {
  const { db, typed, binding } = setup();
  const source = {
    read: vi.fn(async () => ({ client: { id: "wrong", name: "Snapshot" }, buildings: [] })),
  };
  await expect(boundHierarchy(typed, actor, source)).rejects.toThrow("binding_mismatch");
  source.read.mockImplementation(async () => {
    binding.revision++;
    return { client: { id: "client-7", name: "New upstream name" }, buildings: [] };
  });
  // Return distinct row snapshots, as PostgreSQL does.
  db.spaceClientBinding.findUnique.mockImplementation(async () => ({ ...binding }));
  await expect(boundHierarchy(typed, actor, source)).rejects.toThrow("binding_stale");
});
it("does not return hierarchy data when Space deletion starts during the upstream read", async () => {
  const { typed, space } = setup();
  const source = {
    read: async () => {
      space.deletingAt = new Date() as never;
      return { client: { id: "client-7", name: "Snapshot" }, buildings: [] };
    },
  };
  await expect(boundHierarchy(typed, actor, source)).rejects.toThrow("space_unavailable");
});
