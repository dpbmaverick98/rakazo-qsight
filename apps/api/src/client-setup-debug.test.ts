import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
  createLogger,
  createTestSink,
  getLogger,
  installLogger,
  runWithLogContext,
} from "@rakazo/logging";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reused: false }));
vi.mock("@rakazo/adapters", () => ({ lockMcpOAuthMaterial: vi.fn() }));
vi.mock("@rakazo/db", () => ({
  ClientSpaceConflictError: class extends Error {},
  isUniqueViolation: () => false,
  createSpaceForMember: async () => ({ id: "target-space", reused: state.reused }),
  createRepos: () => ({ createBot: async () => ({ id: "setup-bot" }) }),
  runAsSystem: (_label: string, work: () => unknown) => work(),
  runAsTenant: (_actor: unknown, work: () => unknown) => work(),
  runAsSystemInTransaction: vi.fn(),
  lockSpaceDeletion: vi.fn(),
}));
vi.mock("./availability.js", () => ({ lockOwner: vi.fn(), makeServerAvailableInSpace: vi.fn() }));
vi.mock("./space-client-binding.js", () => ({
  bindingAccess: vi.fn(),
  resolveClientBinding: async () => ({ externalClientId: "client", revision: 1 }),
}));

import { setupClient } from "./client-setup.js";

const previous = getLogger();
afterEach(() => {
  installLogger(previous);
  vi.unstubAllEnvs();
});
it.each([false, true])("covers setup stages and correlated IDs when reuse=%s", async (reused) => {
  state.reused = reused;
  vi.stubEnv("CLIENT_SETUP_DEBUG", "1");
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  const prisma = {
    bot: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(reused ? { id: "setup-bot" } : null),
    },
    $transaction: async () => "setup-server",
  } as unknown as PrismaClient;
  const client = { id: "client", name: "Example" };
  const source = {
    findClient: vi.fn().mockResolvedValue(reused ? client : null),
    createClient: vi.fn().mockResolvedValue(client),
  };
  const result = await runWithLogContext(
    { "request.id": "request", "trace.id": "a".repeat(32) },
    () =>
      setupClient(prisma, { userId: "actor", spaceId: "original" } as Actor, source, client.name),
  );
  expect(result).toMatchObject({
    clientId: "client",
    spaceId: "target-space",
    botId: "setup-bot",
    serverId: "setup-server",
  });
  const names = sink.events.map((event) => event.message);
  for (const stage of [
    "client.lookup",
    reused ? "client.reuse" : "client.create",
    "space.resolve",
    "binding",
    "setup_pm",
    "mcp.attach",
  ])
    expect(names).toContain(`client_setup.${stage}`);
  expect(sink.events.every((event) => event["request.id"] === "request")).toBe(true);
  expect(
    sink.events.find(
      (event) =>
        event.message === "client_setup.space.resolve" &&
        event.status === (reused ? "reused" : "created"),
    ),
  ).toMatchObject({ spaceId: "target-space" });
  expect(JSON.stringify(sink.events)).not.toContain(client.name);
});
