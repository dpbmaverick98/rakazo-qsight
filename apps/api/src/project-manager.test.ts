import { createRouterClient } from "@orpc/server";
import { EncryptedSecretStore } from "@rakazo/adapters";
import { qsightHierarchyFromEnv } from "@rakazo/adapters/qsight-hierarchy";
import type { Actor } from "@rakazo/contracts";
import {
  createLogger,
  createTestSink,
  getLogger,
  installLogger,
  runWithLogContext,
} from "@rakazo/logging";
import { afterEach, expect, it, vi } from "vitest";
import { createMcpServers } from "./mcp-servers.js";
import { provisionProjectManager } from "./project-manager.js";
import type { RouterContext } from "./routes/context.js";
import { createRouterContext } from "./routes/context.js";
import { mcpRoutes } from "./routes/mcp.js";

const actor: Actor = {
  userId: "user",
  spaceId: "space",
  email: "user@example.test",
  isDeploymentOwner: true,
};
const input = { projectId: "roof", projectName: "Untrusted name", clientName: "Untrusted client" };
const hierarchy = {
  client: { id: "client", name: "Example Client" },
  buildings: [
    {
      id: "building",
      name: "Building",
      projects: [{ id: "roof", name: "Roof survey", url: "https://example.test/project" }],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
function setup() {
  // biome-ignore lint/suspicious/noExplicitAny: This transaction double accepts several generated Prisma argument shapes.
  type Row = Record<string, any>;
  const state = {
    bots: [] as Row[],
    servers: [] as Row[],
    secrets: [] as Row[],
    assignments: [] as Row[],
  };
  let sequence = 0;
  const prisma = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (run: (tx: typeof prisma) => Promise<unknown>) => {
      const snapshot = structuredClone(state);
      try {
        return await run(prisma);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    }),
    space: {
      findUnique: vi.fn(async () => ({ id: "space", name: "Example Client", isDefault: false })),
    },
    spaceMember: { findUnique: vi.fn(async () => ({ role: "owner" })) },
    spaceClientBinding: {
      findUnique: vi.fn(async () => ({
        externalClientId: "client",
        clientName: "Original",
        revision: 1,
        active: true,
      })),
    },
    bot: {
      findFirst: vi.fn(async ({ where }: Row) =>
        state.bots.find(
          (bot) =>
            (!where.id || bot.id === where.id) &&
            (!where.userId || bot.userId === where.userId) &&
            (!where.spaceId || bot.spaceId === where.spaceId) &&
            (!where.spawnKey || bot.spawnKey === where.spawnKey) &&
            !bot.archivedAt,
        ),
      ),
      update: vi.fn(async ({ where, data }: Row) =>
        Object.assign(state.bots.find((bot) => bot.id === where.id)!, data),
      ),
    },
    mcpServer: {
      findFirst: vi.fn(
        async ({ where }: Row) =>
          state.servers.find(
            (server) =>
              server.spaceId === where.spaceId &&
              server.userId === where.userId &&
              (where.OR?.some((condition: Row) =>
                server.name.startsWith(condition.name.startsWith),
              ) ||
                (where.id && where.id === server.id) ||
                (where.slug && where.slug === server.slug) ||
                (where.name &&
                  (typeof where.name === "string"
                    ? where.name === server.name
                    : server.name.startsWith(where.name.startsWith)))) &&
              (where.allBots === undefined || where.allBots === server.allBots) &&
              (where.endpoint === undefined || where.endpoint === server.endpoint),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: Row) => {
        const row = {
          id: `server-${++sequence}`,
          description: "",
          availableIn: [],
          allSpaces: false,
          allBots: false,
          revision: 1,
          healthStatus: "unknown",
          healthMessage: null,
          healthToolCount: null,
          healthCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.servers.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: Row) =>
        Object.assign(state.servers.find((server) => server.id === where.id)!, data, {
          revision: 2,
        }),
      ),
    },
    secret: {
      create: vi.fn(async ({ data }: Row) => {
        state.secrets.push(data);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: Row) => {
        state.secrets = state.secrets.filter((secret) => secret.id !== where.id);
      }),
      count: vi.fn(
        async ({ where }: Row) =>
          state.secrets.filter((secret) => secret.ciphertext === where.ciphertext).length,
      ),
    },
    botSecret: { count: async () => 0 },
    vaultCredential: { count: async () => 0 },
    integrationProviderConfig: { count: async () => 0 },
    botMcpServer: {
      count: vi.fn(
        async ({ where }: Row) =>
          state.assignments.filter(
            (assignment) =>
              assignment.spaceId === where.spaceId &&
              assignment.userId === where.userId &&
              assignment.serverId === where.serverId &&
              assignment.botId !== where.botId.not,
          ).length,
      ),
      deleteMany: vi.fn(async ({ where }: Row) => {
        state.assignments = state.assignments.filter(
          (assignment) => assignment.botId !== where.botId,
        );
      }),
      create: vi.fn(async ({ data }: Row) => {
        state.assignments.push(data);
        return data;
      }),
    },
  };
  const secrets = new EncryptedSecretStore("fake-encryption-key-for-offline-tests");
  const upstream = vi.fn(async (url: URL) =>
    String(url).includes("manager-token")
      ? Response.json({
          project_id: "roof",
          token_id: "test-token-id",
          token: "fake-project-read-token",
        })
      : String(url).includes("/tokens/")
        ? Response.json({ revoked: true })
        : Response.json(hierarchy),
  );
  vi.stubGlobal("fetch", upstream);
  const source = qsightHierarchyFromEnv({
    QSIGHT_BASE_URL: "https://hierarchy.example.test",
    QSIGHT_AGENT_TOKEN: "fake-owner-write-token",
  })!;
  const deps = {
    prisma,
    secrets,
    projectManagers: source,
    events: { publishRosterChange: vi.fn(async () => {}) },
    env: { mcpAllowPrivateEndpoint: false },
    remoteConnectors: { resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }] },
  };
  const repos = {
    listBots: vi.fn(async () => state.bots),
    createBot: vi.fn(async (_actor: Actor, request: Row) =>
      prisma.$transaction(async (tx) => {
        const bot: Row = { id: "pm", userId: "user", spaceId: "space", ...request };
        delete bot.seed;
        state.bots.push(bot);
        await request.seed(tx, bot.id);
        return bot;
      }),
    ),
  };
  const mcp = createMcpServers(deps as never, {} as never, {} as never);
  const ctx = {
    deps,
    repos,
    prepareMcpServer: mcp.prepareMcpServer,
    insertMcpServer: mcp.insertMcpServer,
  } as unknown as RouterContext;
  return { ctx, deps, state, prisma, repos, upstream };
}
it("mints only server-side, encrypts credentials, attaches only the scoped server and returns no token", async () => {
  const test = setup();
  test.state.servers.push({
    id: "owner",
    name: "Vendor One Pilot",
    allBots: false,
    spaceId: "space",
    userId: "user",
    slug: "owner",
  });
  const result = await provisionProjectManager(test.ctx, actor, input);
  expect(result).toMatchObject({
    bot: { id: "pm", spawnKey: "pm:roof" },
    server: { name: "Vendor One PM — Roof survey", allBots: false },
    created: true,
  });
  expect(test.state.bots[0]).toMatchObject({
    name: "PM — Roof survey",
    inheritMcpServers: false,
    dailyCheckIns: false,
    fleetManagement: false,
  });
  expect(test.state.bots[0]!.instructions).toContain('"client":"Example Client"');
  expect(test.state.bots[0]!.instructions).not.toContain("Untrusted");
  expect(test.state.bots[0]!.instructions).toContain("Use Vendor One tools");
  expect(test.state.assignments).toEqual([
    {
      botId: "pm",
      serverId: result.server.id,
      spaceId: "space",
      userId: "user",
      allowAllTools: true,
      allowedTools: [],
    },
  ]);
  expect(test.state.servers.find((server) => server.id === "owner")).toHaveProperty(
    "allBots",
    false,
  );
  expect(JSON.stringify(result)).not.toMatch(
    /fake-project-read-token|fake-owner-write-token|ciphertext/,
  );
  expect(JSON.stringify(test.state.secrets)).not.toContain("fake-project-read-token");
  const secret = test.state.secrets[0]!;
  expect(await test.deps.secrets.load(secret.ciphertext, secret.id)).toContain(
    "Bearer fake-project-read-token",
  );
  expect(test.upstream.mock.calls.map(([url]) => String(url))).toContain(
    "https://hierarchy.example.test/api/v2/agent/projects/roof/manager-token",
  );
});
it("reuses scoped credentials and IDs, and repairs an older PM's assignments", async () => {
  const test = setup();
  const first = await provisionProjectManager(test.ctx, actor, input);
  test.state.assignments.push(
    { botId: "pm", serverId: "owner" },
    { botId: "other", serverId: "owner" },
  );
  const second = await provisionProjectManager(test.ctx, actor, input);
  expect(second).toMatchObject({
    bot: { id: first.bot.id },
    server: { id: first.server.id },
    created: false,
  });
  expect(test.repos.createBot).toHaveBeenCalledTimes(1);
  expect(test.state.servers).toHaveLength(1);
  expect(test.state.secrets).toHaveLength(1);
  expect(test.state.assignments.filter((row) => row.botId === "pm")).toHaveLength(1);
  expect(test.state.assignments).toContainEqual({ botId: "other", serverId: "owner" });
});
it.each(["space", "personal", "project"])(
  "rejects an unavailable %s before minting",
  async (condition) => {
    const test = setup();
    if (condition === "space") test.prisma.space.findUnique.mockResolvedValue(null as never);
    if (condition === "personal")
      test.prisma.space.findUnique.mockResolvedValue({
        id: "space",
        name: "Personal",
        isDefault: true,
      });
    await expect(
      provisionProjectManager(test.ctx, actor, {
        ...input,
        projectId: condition === "project" ? "other" : "roof",
      }),
    ).rejects.toMatchObject({ code: condition === "project" ? "NOT_FOUND" : "CONFLICT" });
    expect(test.upstream.mock.calls.some(([url]) => String(url).includes("manager-token"))).toBe(
      false,
    );
    expect(test.state.bots).toHaveLength(0);
  },
);
it.each(["hierarchy", "token"])(
  "sanitizes upstream %s failure before any database write",
  async (condition) => {
    const test = setup();
    test.upstream.mockImplementation(async (url) =>
      String(url).includes(condition === "token" ? "manager-token" : "hierarchy?")
        ? new Response("fake-secret", { status: 502 })
        : Response.json(hierarchy),
    );
    await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    expect(test.state.bots).toHaveLength(0);
    expect(test.state.servers).toHaveLength(0);
    expect(test.state.secrets).toHaveLength(0);
  },
);
it("rolls back bot, server and secret if attachment fails", async () => {
  const test = setup();
  test.prisma.botMcpServer.create.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow(
    "database unavailable",
  );
  expect(test.state.bots).toHaveLength(0);
  expect(test.state.servers).toHaveLength(0);
  expect(test.state.secrets).toHaveLength(0);
});
it("does not change an existing PM when attachment fails", async () => {
  const test = setup();
  await provisionProjectManager(test.ctx, actor, input);
  const before = structuredClone(test.state);
  test.prisma.botMcpServer.create.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow();
  expect(test.state).toEqual(before);
});
it("requires an authenticated session on the RPC", async () => {
  const test = setup();
  const context = createRouterContext(test.deps as never);
  const client = createRouterClient(mcpRoutes(context), { context: { actor: null } });
  await expect(client.mcp.servers.provisionProjectManager(input)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(test.upstream).not.toHaveBeenCalled();
});

it("repairs the spawn-key winner when another request creates it first", async () => {
  const test = setup();
  const first = await provisionProjectManager(test.ctx, actor, input);
  test.repos.listBots.mockResolvedValueOnce([]);
  test.repos.createBot.mockResolvedValueOnce(first.bot);
  const again = await provisionProjectManager(test.ctx, actor, input);
  expect(again).toMatchObject({
    bot: { id: first.bot.id },
    server: { id: first.server.id },
    created: false,
  });
  expect(test.state.servers).toHaveLength(1);
  expect(test.state.assignments).toHaveLength(1);
});
it.each(["allBots", "allSpaces"])(
  "rejects reuse of a %s server without changing it",
  async (flag) => {
    const test = setup();
    await provisionProjectManager(test.ctx, actor, input);
    test.state.servers[0]![flag] = true;
    const before = structuredClone(test.state);
    await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(test.state).toEqual(before);
  },
);
it("refuses to rewrite another member's PM", async () => {
  const test = setup();
  await provisionProjectManager(test.ctx, actor, input);
  test.state.bots[0]!.userId = "other-member";
  const before = structuredClone(test.state);
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(test.state).toEqual(before);
});

it("rejects a server exposed in another space without changing it", async () => {
  const test = setup();
  await provisionProjectManager(test.ctx, actor, input);
  test.state.servers[0]!.availableIn = [{ spaceId: "other" }];
  const before = structuredClone(test.state);
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(test.state).toEqual(before);
});
it("validates the MCP endpoint before persisting product records", async () => {
  const test = setup();
  test.deps.remoteConnectors.resolveHostname = async () => [{ address: "127.0.0.1", family: 4 }];
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(test.state.bots).toHaveLength(0);
  expect(test.state.secrets).toHaveLength(0);
});
it.each(["QSight Pilot", "Vendor One Pilot"])(
  "refuses provisioning while %s is shared with all bots",
  async (name) => {
    const test = setup();
    test.state.servers.push({
      id: "owner",
      name,
      allBots: true,
      endpoint: "https://hierarchy.example.test/mcp",
      spaceId: "space",
      userId: "user",
      slug: "owner",
    });
    await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow(/All bots/);
    expect(test.state.bots).toHaveLength(0);
    expect(test.state.assignments).toHaveLength(0);
  },
);

it("PM provisioning follows the immutable ID after a Space rename and ignores input names", async () => {
  const test = setup();
  test.prisma.space.findUnique.mockResolvedValue({
    id: "space",
    name: "Another client",
    isDefault: false,
  });
  await provisionProjectManager(test.ctx, actor, input);
  const url = test.upstream.mock.calls[0]![0];
  expect(url.searchParams.get("client_id")).toBe("client");
  expect(url.searchParams.has("client_name")).toBe(false);
});
it("rejects missing binding or membership before PM credential minting", async () => {
  for (const condition of ["binding", "membership"]) {
    const test = setup();
    if (condition === "binding")
      test.prisma.spaceClientBinding.findUnique.mockResolvedValue(null as never);
    else test.prisma.spaceMember.findUnique.mockResolvedValue(null as never);
    await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow();
    expect(test.upstream).not.toHaveBeenCalled();
  }
});
it("rejects stale binding revisions and ordinary members before PM minting", async () => {
  const test = setup();
  await expect(
    provisionProjectManager(test.ctx, actor, { ...input, bindingRevision: 2 }),
  ).rejects.toThrow("binding_stale");
  test.prisma.spaceMember.findUnique.mockResolvedValue({ role: "member" });
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow("forbidden");
  expect(test.upstream).not.toHaveBeenCalled();
});

it("promotes the setup PM in place and removes its owner connection", async () => {
  const test = setup();
  test.state.bots.push({ id: "setup", userId: "user", spaceId: "space", spawnKey: "setup:client" });
  test.state.assignments.push({
    botId: "setup",
    serverId: "owner",
    spaceId: "space",
    userId: "user",
  });
  const result = await provisionProjectManager(test.ctx, actor, { ...input, finishSetup: true });
  expect(result.bot).toMatchObject({ id: "setup", spawnKey: "pm:roof" });
  expect(test.repos.createBot).not.toHaveBeenCalled();
  expect(test.state.bots).toHaveLength(1);
  expect(test.state.assignments).toEqual([
    expect.objectContaining({ botId: "setup", serverId: result.server.id }),
  ]);
  expect(test.state.servers[0]).toHaveProperty("managedCredentialId", "test-token-id");
  await provisionProjectManager(test.ctx, actor, { ...input, finishSetup: true });
  expect(test.state.bots).toHaveLength(1);
  expect(test.state.servers).toHaveLength(1);
  expect(
    test.upstream.mock.calls.some(([url]) => String(url).endsWith("/tokens/test-token-id")),
  ).toBe(true);
});
it.each(["validation", "attachment", "duplicate"])(
  "revokes the unused minted token after %s",
  async (failure) => {
    const test = setup();
    if (failure === "duplicate") await provisionProjectManager(test.ctx, actor, input);
    if (failure === "validation")
      test.deps.remoteConnectors.resolveHostname = async () => [
        { address: "127.0.0.1", family: 4 },
      ];
    if (failure === "attachment")
      test.prisma.botMcpServer.create.mockRejectedValueOnce(new Error("offline failure"));
    if (failure === "duplicate") await provisionProjectManager(test.ctx, actor, input);
    else await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow();
    expect(
      test.upstream.mock.calls.filter(([url]) => String(url).endsWith("/tokens/test-token-id")),
    ).toHaveLength(1);
  },
);
it("does not promote setup when the hierarchy contains more than one project", async () => {
  const test = setup();
  test.upstream.mockResolvedValueOnce(
    Response.json({
      ...hierarchy,
      buildings: [
        {
          ...hierarchy.buildings[0],
          projects: [
            ...hierarchy.buildings[0]!.projects,
            { id: "second", name: "Second", url: "https://example.test/second" },
          ],
        },
      ],
    }),
  );
  await expect(
    provisionProjectManager(test.ctx, actor, { ...input, finishSetup: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(test.upstream.mock.calls.some(([url]) => String(url).includes("manager-token"))).toBe(
    false,
  );
});
it("retries revocation without changing the surviving PM", async () => {
  const test = setup();
  await provisionProjectManager(test.ctx, actor, input);
  const revoke = vi
    .spyOn(test.deps.projectManagers, "revokeManagerToken")
    .mockRejectedValueOnce(new Error("brief outage"))
    .mockResolvedValueOnce();
  await provisionProjectManager(test.ctx, actor, input);
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(test.state.bots).toHaveLength(1);
  expect(test.state.servers).toHaveLength(1);
});

it("revokes only the duplicate mint and preserves the adopted issuer ID", async () => {
  const test = setup();
  const mint = test.deps.projectManagers.managerServer.bind(test.deps.projectManagers);
  let sequence = 0;
  vi.spyOn(test.deps.projectManagers, "managerServer").mockImplementation(async (id, name) => ({
    ...(await mint(id, name)),
    tokenId: `issued-${++sequence}`,
  }));
  const revoke = vi.spyOn(test.deps.projectManagers, "revokeManagerToken").mockResolvedValue();
  await provisionProjectManager(test.ctx, actor, input);
  const secret = test.state.secrets[0]!.id;
  await provisionProjectManager(test.ctx, actor, input);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("issued-2");
  expect(test.state.servers[0]).toMatchObject({
    managedCredentialId: "issued-1",
    secretId: secret,
  });
});

it("rejects generic edits of managed project credentials", async () => {
  const test = setup();
  const result = await provisionProjectManager(test.ctx, actor, input);
  test.prisma.mcpServer.findFirst.mockResolvedValueOnce(test.state.servers[0]!);
  const context = createRouterContext(test.deps as never);
  const client = createRouterClient(mcpRoutes(context), { context: { actor } });
  await expect(
    client.mcp.servers.update({ id: result.server.id, secret: "fake-owner-substitution" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(test.state.servers[0]).toHaveProperty("managedCredentialId", "test-token-id");
});

it("keeps the committed credential if post-commit notification fails", async () => {
  const test = setup();
  test.deps.events.publishRosterChange.mockRejectedValueOnce(new Error("notification unavailable"));
  const revoke = vi.spyOn(test.deps.projectManagers, "revokeManagerToken");
  await expect(provisionProjectManager(test.ctx, actor, input)).rejects.toThrow(
    "notification unavailable",
  );
  expect(test.state.servers[0]).toHaveProperty("managedCredentialId", "test-token-id");
  expect(revoke).not.toHaveBeenCalled();
});

it("logs correlated promotion and unused-token revocation without credentials", async () => {
  vi.stubEnv("CLIENT_SETUP_DEBUG", "1");
  const previous = getLogger();
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  const test = setup();
  test.state.bots.push({ id: "setup", userId: "user", spaceId: "space", spawnKey: "setup:client" });
  try {
    await runWithLogContext({ "request.id": "finish-request" }, async () => {
      await provisionProjectManager(test.ctx, actor, { ...input, finishSetup: true });
      await provisionProjectManager(test.ctx, actor, { ...input, finishSetup: true });
    });
    expect(sink.events).toContainEqual(
      expect.objectContaining({
        message: "client_setup.promotion",
        status: "committed",
        botId: "setup",
        clientId: "client",
        actorId: "user",
        "request.id": "finish-request",
      }),
    );
    expect(sink.events).toContainEqual(
      expect.objectContaining({
        message: "client_setup.token.revoke",
        status: "ok",
        durationMs: expect.any(Number),
      }),
    );
    const serialized = JSON.stringify(sink.events);
    for (const secret of ["test-token-id", "Untrusted name", "Untrusted client", "Authorization"])
      expect(serialized).not.toContain(secret);
  } finally {
    installLogger(previous);
    vi.unstubAllEnvs();
  }
});
