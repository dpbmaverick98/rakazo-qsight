import { BOT_NAME_MAX_LENGTH } from "@rakazo/contracts";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spaces: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("../../lib/rpc", () => ({
  rpc: { spaces: { list: mocks.spaces }, bots: { list: mocks.list, create: mocks.create } },
}));
vi.mock("@rakazo/ui-web", () => ({ Button: () => null }));

import { ensureFirstBot } from "./first-bot";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "created" });
  mocks.spaces.mockResolvedValue({
    current: { id: "client", name: "Example Client" },
    spaces: [
      { id: "personal", isDefault: true },
      { id: "client", isDefault: false },
    ],
  });
});

it("creates the current client's lead even when Personal is listed first", async () => {
  await ensureFirstBot();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Example Client Lead",
      instructions:
        "You are the client lead for Example Client. Help with its buildings, projects and commercial work; ask what to take care of for this client first, and keep work scoped to this client unless asked otherwise.",
      spawnKey: "onboarding:first",
    }),
  );
});

it("preserves Lead within the contract's name limit", async () => {
  mocks.spaces.mockResolvedValue({
    current: { id: "client", name: "X".repeat(120) },
    spaces: [{ id: "client", isDefault: false }],
  });
  await ensureFirstBot();
  expect(mocks.create.mock.calls[0]?.[0].name).toBe(`${"X".repeat(BOT_NAME_MAX_LENGTH - 5)} Lead`);
});

it("keeps Chief and its empty instructions in Personal", async () => {
  mocks.spaces.mockResolvedValue({
    current: { id: "personal", name: "Archive (Personal)" },
    spaces: [{ id: "personal", isDefault: true }],
  });
  await ensureFirstBot();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Chief", instructions: "" }),
  );
});

it("does not reuse a legacy Chief in a client Space", async () => {
  mocks.list.mockResolvedValue([{ id: "legacy", name: "Chief", spawnKey: null }]);
  await expect(ensureFirstBot()).resolves.toEqual({ id: "created" });
});

it("reuses the idempotency key and shares concurrent attempts", async () => {
  mocks.list.mockResolvedValue([
    { id: "existing", name: "Example Client Lead", spawnKey: "onboarding:first" },
  ]);
  expect(await Promise.all([ensureFirstBot(), ensureFirstBot()])).toEqual([
    { id: "existing" },
    { id: "existing" },
  ]);
  expect(mocks.list).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("reuses the winning bot after a create race", async () => {
  mocks.create.mockRejectedValue(new Error("conflict"));
  mocks.list
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "winner", spawnKey: "onboarding:first" }]);
  await expect(ensureFirstBot()).resolves.toEqual({ id: "winner" });
});
