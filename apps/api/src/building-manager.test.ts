import { expect, it, vi } from "vitest";
import { provisionBuildingManager } from "./building-manager.js";

const mocks = vi.hoisted(() => ({
  listBots: vi.fn(),
  createBot: vi.fn(),
  access: vi.fn(),
  bound: vi.fn(),
  resolve: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@rakazo/db", () => ({ createRepos: () => mocks, lockSpaceDeletion: mocks.lock }));
vi.mock("./space-client-binding.js", () => ({
  bindingAccess: mocks.access,
  boundHierarchy: mocks.bound,
  resolveClientBinding: mocks.resolve,
}));
const actor = {
  spaceId: "space",
  userId: "user",
  email: "user@example.test",
  isDeploymentOwner: false,
};
const building = {
  id: "north",
  name: "North",
  address: "Example Street",
  url: "https://example.test/north",
};
function setup() {
  vi.resetAllMocks();
  mocks.bound.mockResolvedValue({
    hierarchy: {
      client: { name: "Client" },
      buildings: [{ ...building, projects: [{ id: "roof" }] }],
    },
  });
  mocks.listBots.mockResolvedValue([]);
  const tx = { $queryRaw: vi.fn(), bot: { update: vi.fn() } };
  mocks.createBot.mockImplementation(async (_actor, input) => {
    await input.seed(tx, "manager");
    return { id: "manager" };
  });
  return tx;
}
it("creates a building-scoped default manager with a clean details question and isolated tools", async () => {
  const tx = setup();
  expect(await provisionBuildingManager({} as never, actor, {} as never, building, 2)).toBe(
    "manager",
  );
  expect(mocks.createBot).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({
      name: "Proj. Manager - Sam",
      spawnKey: "building:north",
      initialMessage: {
        role: "bot",
        blocks: [{ kind: "text", text: "What is the project name and scope for this building?" }],
      },
    }),
  );
  expect(tx.bot.update).toHaveBeenCalledWith({
    where: { id: "manager" },
    data: { inheritMcpServers: false, crossSpaceCommunication: false },
  });
  expect(mocks.resolve).toHaveBeenCalledWith(tx, actor, 2);
});
it.each(["building:north", "pm:roof"])(
  "reuses %s on retry, including after promotion",
  async (spawnKey) => {
    setup();
    mocks.listBots.mockResolvedValue([{ id: "existing", spawnKey }]);
    expect(await provisionBuildingManager({} as never, actor, {} as never, building, 2)).toBe(
      "existing",
    );
    expect(mocks.createBot).not.toHaveBeenCalled();
  },
);
it("rejects a building outside the authorized hierarchy", async () => {
  setup();
  mocks.bound.mockResolvedValue({ hierarchy: { buildings: [] } });
  await expect(
    provisionBuildingManager({} as never, actor, {} as never, building, 2),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mocks.createBot).not.toHaveBeenCalled();
});
