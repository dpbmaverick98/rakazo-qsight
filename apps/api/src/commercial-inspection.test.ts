import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, MessageBlock } from "@rakazo/contracts";
import type { CommercialInspectionSelection } from "@rakazo/contracts/project-commercial";
import { commercialDocumentsFixture } from "@rakazo/contracts/project-commercial-fixture";
import {
  blocksToAgentHistorySegments,
  blocksToAgentHistoryText,
  selectableMessageText,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { resolveCommercialInspection } from "./commercial-inspection.js";
import type * as ComputerModule from "./computer-control.js";
import { mountHierarchyRoute } from "./hierarchy.js";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import type * as SharedModule from "./routes/shared.js";
import type * as TaughtModule from "./taught-skills.js";
import type { ThreadTarget } from "./thread-target.js";
import { sendThreadMessage } from "./thread-target.js";

// Keep model funding and teaching outside this inspection admission test.
vi.mock("./routes/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  modelSetup: vi.fn(async () => ({ needsModel: false, hasDeployment: false })),
}));
vi.mock("./taught-skills.js", async (importOriginal) => ({
  ...(await importOriginal<typeof TaughtModule>()),
  assertTeachingSendAllowed: vi.fn(),
}));
vi.mock("./computer-control.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerModule>()),
  answerComputerRequest: vi.fn(async () => undefined),
}));

const actor = { spaceId: "space", userId: "user" } as Actor;
const selection: CommercialInspectionSelection = {
  projectId: "roof",
  bindingRevision: 1,
  claimId: "claim",
  vendorId: "vendor",
  packageId: "drywall",
  fileId: "proposal",
};
const target = {
  kind: "bot",
  botId: "bot",
  threadId: "thread",
  bot: { spawnKey: "pm:roof", computer: null },
} as ThreadTarget;

function fixture() {
  const binding = { active: true, externalClientId: "client", revision: 1 };
  const commercial = structuredClone(commercialDocumentsFixture);
  const hierarchy = {
    client: { id: "client", name: "Client" },
    buildings: [
      {
        id: "building",
        name: "Building",
        projects: [
          { id: "roof", name: "Canonical roof", url: "https://example.test/projects/roof" },
        ],
      },
    ],
  };
  const tx = {
    space: { findUnique: vi.fn(async () => ({ isDefault: false, deletingAt: null })) },
    spaceMember: {
      findUnique: vi.fn(async () => ({ role: "member" })),
      count: vi.fn(async () => 1),
    },
    spaceClientBinding: { findUnique: vi.fn(async () => ({ ...binding })) },
    bot: { findFirst: vi.fn(async () => ({ spawnKey: "pm:roof" })) },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    user: { findMany: vi.fn(async () => []) },
    thread: { update: vi.fn(async () => ({ nextMessageSeq: 2, nextEventSeq: 2 })) },
    message: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { blocks: MessageBlock[] } }) => ({
        ...data,
        id: "message",
        seq: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
      update: vi.fn(),
      findMany: vi.fn(async () => [
        { id: "ask", blocks: [{ kind: "ask", text: "Which?", status: "pending" }] },
      ]),
      findFirst: vi.fn(async () => ({
        id: "ask",
        blocks: [{ kind: "ask", text: "Which?", status: "pending" }],
      })),
    },
    task: {
      create: vi.fn(async (_input: unknown) => ({ id: "task" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    run: {
      findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
      create: vi.fn(async () => ({ id: "run", taskId: "task", status: "queued", userId: "user" })),
      findFirst: vi.fn(async () => ({ botId: "bot", userId: "user" })),
      findUnique: vi.fn(async () => ({ status: "queued" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    steeringMessage: { create: vi.fn() },
    event: { create: vi.fn(async () => ({ seq: 1, threadId: "thread" })) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (db: typeof tx) => unknown) => fn(tx)) };
  const source = {
    read: vi.fn(async () => hierarchy),
    readCommercial: vi.fn(async () => commercial),
  };
  const deps = { prisma, projectManagers: source } as unknown as RouterDeps;
  return { binding, commercial, hierarchy, tx, prisma, source, deps };
}

it("resolves canonical IDs and names with fresh read-only projections, without writes or runs", async () => {
  const f = fixture();
  const result = await resolveCommercialInspection(f.deps, actor, target, selection);
  expect(result.prompt).toContain('"project":{"id":"roof","name":"Canonical roof"}');
  expect(result.prompt).toContain('"document":{"id":"proposal","name":"Proposal.pdf"}');
  expect(result.prompt).not.toContain("https:");
  expect(result.prompt).not.toContain("1234.50");
  expect(f.source.read).toHaveBeenCalledWith("client", true);
  expect(f.source.readCommercial).toHaveBeenCalledWith("roof", true);
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
  expect(f.tx.message.create).not.toHaveBeenCalled();
  expect(f.tx.task.create).not.toHaveBeenCalled();
  expect(f.tx.run.create).not.toHaveBeenCalled();
});

it.each(["projectId", "claimId", "vendorId", "packageId", "fileId"] as const)(
  "rejects a forged or cross-project %s before writes",
  async (key) => {
    const f = fixture();
    await expect(
      resolveCommercialInspection(f.deps, actor, target, {
        ...selection,
        [key]: "other-project-reference",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  },
);

it("rejects references that exist under another claim or vendor or package", async () => {
  for (const parent of ["claim", "vendor", "package"] as const) {
    const f = fixture();
    const claim = f.commercial.claims[0]!;
    const vendor = claim.sub_vendors[0]!;
    const workPackage = vendor.work_packages[0]!;
    if (parent === "claim") {
      f.commercial.claims.push({ ...structuredClone(claim), id: "other" });
      claim.sub_vendors = [];
    } else if (parent === "vendor") {
      claim.sub_vendors.push({ ...structuredClone(vendor), id: "other" });
      vendor.work_packages = [];
    } else {
      vendor.work_packages.push({ ...structuredClone(workPackage), id: "other" });
      workPackage.documents = [];
    }
    await expect(
      resolveCommercialInspection(f.deps, actor, target, selection),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
});

it("rejects stale binding before upstream reads and changes during the commercial read", async () => {
  const f = fixture();
  await expect(
    resolveCommercialInspection(f.deps, actor, target, { ...selection, bindingRevision: 2 }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "binding_stale" });
  expect(f.source.read).not.toHaveBeenCalled();
  f.source.readCommercial.mockImplementation(async () => {
    f.binding.revision++;
    return f.commercial;
  });
  await expect(resolveCommercialInspection(f.deps, actor, target, selection)).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
});

it("rejects ambiguous project/claim IDs, unscoped bots and missing document projections", async () => {
  const f = fixture();
  f.hierarchy.buildings[0]!.projects.push({
    id: "roof",
    name: "Ambiguous",
    url: "https://example.test/projects/roof",
  });
  await expect(resolveCommercialInspection(f.deps, actor, target, selection)).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  f.hierarchy.buildings[0]!.projects.pop();
  f.commercial.claims.push(structuredClone(f.commercial.claims[0]!));
  await expect(resolveCommercialInspection(f.deps, actor, target, selection)).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  f.commercial.claims.pop();
  delete f.commercial.claims[0]!.sub_vendors[0]!.work_packages[0]!.documents;
  await expect(resolveCommercialInspection(f.deps, actor, target, selection)).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  await expect(
    resolveCommercialInspection(
      f.deps,
      actor,
      { ...target, bot: { spawnKey: null } } as ThreadTarget,
      selection,
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("clears omitted descendants and rejects orphaned descendants after parent changes", async () => {
  const f = fixture();
  const result = await resolveCommercialInspection(f.deps, actor, target, {
    projectId: "roof",
    bindingRevision: 1,
    claimId: "claim",
  });
  expect(result.prompt).toContain('"vendor":null,"workPackage":null,"document":null');
  await expect(
    resolveCommercialInspection(f.deps, actor, target, { ...selection, vendorId: undefined }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it.each(["new", "steering", "waiting", "ordinary", "stale-at-commit", "changed-bot"] as const)(
  "admits %s sends through the existing run/message path",
  async (mode) => {
    const f = fixture();
    const inspection = await resolveCommercialInspection(f.deps, actor, target, selection);
    if (mode === "steering" || mode === "waiting") {
      f.tx.run.findMany.mockResolvedValue([
        {
          id: "existing",
          taskId: "task",
          userId: "user",
          botId: "bot",
          trigger: "user",
          status: mode === "steering" ? "running" : "waiting_input",
        },
      ]);
    }
    if (mode === "stale-at-commit") f.binding.revision++;
    if (mode === "changed-bot") f.tx.bot.findFirst.mockResolvedValue({ spawnKey: "pm:other" });
    const send = sendThreadMessage(
      {
        prisma: f.prisma as unknown as PrismaClient,
        sandbox: {} as never,
        events: { notify: vi.fn(async () => undefined) } as never,
        jobs: { enqueue: vi.fn(async () => undefined) } as never,
      },
      actor,
      target,
      { text: "Review this", inspection: mode === "ordinary" ? undefined : inspection },
    );
    if (mode === "stale-at-commit" || mode === "changed-bot") {
      await expect(send).rejects.toMatchObject({
        code: mode === "stale-at-commit" ? "CONFLICT" : "BAD_REQUEST",
      });
      expect(f.tx.message.create).not.toHaveBeenCalled();
      expect(f.tx.task.create).not.toHaveBeenCalled();
      expect(f.tx.run.create).not.toHaveBeenCalled();
      return;
    }
    await expect(send).resolves.toMatchObject({
      runId: mode === "new" || mode === "ordinary" ? "run" : "existing",
    });
    const blocks = f.tx.message.create.mock.calls[0]![0].data.blocks;
    expect(selectableMessageText({ blocks })).toBe("Review this");
    if (mode === "ordinary") {
      expect(blocks).toEqual([{ kind: "text", text: "Review this" }]);
      expect(f.tx.task.create.mock.calls[0]![0]).toMatchObject({ data: { prompt: "Review this" } });
      return;
    }
    expect(blocksToAgentHistoryText(blocks)).toContain(inspection.prompt);
    expect(blocksToAgentHistorySegments(blocks)).toEqual([
      { text: `Review this\n\n${inspection.prompt}` },
    ]);
    if (mode === "new")
      expect(f.tx.task.create.mock.calls[0]![0]).toMatchObject({
        data: { prompt: `Review this\n\n${inspection.prompt}` },
      });
    else {
      expect(f.tx.task.create).not.toHaveBeenCalled();
      expect(f.tx.run.create).not.toHaveBeenCalled();
      expect(f.tx.steeringMessage.create).toHaveBeenCalledWith({
        data: { messageId: "message", botId: "bot", userId: "user", runId: "existing" },
      });
    }
  },
);

it("accepts an inspection-bearing HTTP send and reaches the existing PM run", async () => {
  const f = fixture();
  f.tx.bot.findFirst.mockResolvedValue({
    spawnKey: "pm:roof",
    id: "bot",
    thread: { id: "thread" },
    computer: null,
  } as Awaited<ReturnType<typeof f.tx.bot.findFirst>>);
  const handler = new RPCHandler(
    createRouter({
      ...f.deps,
      env: { webOrigin: "http://127.0.0.1", agentRuntime: "scripted" },
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    } as unknown as RouterDeps),
  );
  const { response } = await handler.handle(
    new Request("http://127.0.0.1/rpc/threads/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: { botId: "bot", text: "Review this", commercialInspection: selection },
      }),
    }),
    { prefix: "/rpc", context: { actor } },
  );
  expect(response?.status).toBe(200);
  expect(await response!.json()).toMatchObject({ json: { runId: "run" } });
  expect(f.tx.task.create.mock.calls[0]![0]).toMatchObject({
    data: { prompt: expect.stringContaining('"document":{"id":"proposal","name":"Proposal.pdf"}') },
  });
});

it.each(["projectId", "claimId", "vendorId", "packageId", "fileId"] as const)(
  "rejects preview route ancestry mismatch in %s before requesting bytes",
  async (key) => {
    const f = fixture();
    const previewDocument = vi.fn(async () => new Response("private bytes"));
    const app = new Hono();
    mountHierarchyRoute(app, {
      sessionActor: async () => actor,
      resolveBinding: async () => ({
        externalClientId: "client",
        clientName: "Client",
        revision: 1,
      }),
      source: { ...f.source, previewDocument },
      authorizePreview: async (actor, _botId, selection) => {
        await resolveCommercialInspection(f.deps, actor, target, selection);
      },
    });
    const input = { ...selection, [key]: "foreign" };
    const query = new URLSearchParams({
      botId: "bot",
      claimId: input.claimId,
      vendorId: input.vendorId!,
      packageId: input.packageId!,
    });
    const response = await app.request(
      `/api/agent-plane/projects/${input.projectId}/documents/${input.fileId}/preview?${query}`,
      {
        headers: { "x-rakazo-binding-revision": "1" },
      },
    );
    expect(response.status).toBe(400);
    expect(previewDocument).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private bytes");
  },
);
