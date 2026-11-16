import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, MessageBlock } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerComputerRequest } from "../computer-control.js";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";
import { purgeClearedThreadMemory } from "../thread-memory.js";
import type { ThreadTarget } from "../thread-target.js";
import { takeoverReleaser } from "./threads.js";

vi.mock("../computer-control.js", () => ({
  answerComputerRequest: vi.fn().mockResolvedValue(null),
}));

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

describe("takeoverReleaser", () => {
  const findUnique = vi.fn();
  const deps = { prisma: { run: { findUnique } } } as unknown as RouterDeps;

  beforeEach(() => {
    findUnique.mockReset();
    vi.mocked(answerComputerRequest).mockClear();
  });

  it("hands the screen back to the bot of a direct chat", async () => {
    const target = { kind: "bot", botId: "bot-1" } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-1");
    expect(answerComputerRequest).toHaveBeenCalledWith(deps, actor, "bot-1", "done", "run-1");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("hands the screen back to the group member whose run the reply steers", async () => {
    findUnique.mockResolvedValue({ botId: "bot-2" });
    const target = { kind: "group", memberBotIds: ["bot-1", "bot-2"] } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-2");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "run-2", spaceId: "space-1" },
      select: { botId: true },
    });
    expect(answerComputerRequest).toHaveBeenCalledWith(deps, actor, "bot-2", "done", "run-2");
  });

  it("still steers when the bot waits for someone else", async () => {
    vi.mocked(answerComputerRequest).mockRejectedValueOnce(new ORPCError("CONFLICT"));
    const target = { kind: "bot", botId: "bot-1" } as ThreadTarget;
    await expect(takeoverReleaser(deps, actor, target)("run-1")).resolves.toBeUndefined();
  });

  it("releases nothing when the run is gone", async () => {
    findUnique.mockResolvedValue(null);
    const target = { kind: "group", memberBotIds: ["bot-1"] } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-3");
    expect(answerComputerRequest).not.toHaveBeenCalled();
  });
});

describe("purgeClearedThreadMemory", () => {
  const findMany = vi.fn();
  const purgeHistory = vi.fn();
  const depsWith = (provider: object) =>
    ({
      jobs: { enqueue: vi.fn(async () => undefined) },
      prisma: { run: { findMany } },
      memoryProviders: { resolve: vi.fn().mockResolvedValue({ provider }) },
    }) as unknown as RouterDeps;
  const byThread = {
    purgeHistory,
    describe: () => ({ capabilities: { purgesByThread: true } }),
  };
  const group = {
    kind: "group",
    threadId: "thread-1",
    memberBotIds: ["bot-1", "bot-2"],
  } as ThreadTarget;

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([{ botId: "bot-2" }, { botId: "bot-3" }]);
    purgeHistory.mockReset().mockResolvedValue({ ok: true });
  });

  it("purges current and removed members of a group even with learning off", async () => {
    await purgeClearedThreadMemory(depsWith(byThread), actor, group, 3);
    expect(findMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1" },
      distinct: ["botId"],
      select: { botId: true },
    });
    expect(purgeHistory.mock.calls.map(([request]) => request.botId).sort()).toEqual([
      "bot-1",
      "bot-2",
      "bot-3",
    ]);
    for (const [request] of purgeHistory.mock.calls) {
      expect(request).toMatchObject({ threadId: "thread-1", generations: [2, 3] });
    }
  });

  it("purges nothing for a group when the provider does not purge by thread", async () => {
    await purgeClearedThreadMemory(
      depsWith({
        purgeHistory,
        retainConversation: vi.fn(),
        describe: () => ({ capabilities: {} }),
      }),
      actor,
      group,
      3,
    );
    expect(purgeHistory).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "limits a departing group member's cleanup to that bot (byThread=%s)",
    async (byThread) => {
      await purgeClearedThreadMemory(
        depsWith({
          purgeHistory,
          describe: () => ({ capabilities: { purgesByThread: byThread } }),
        }),
        actor,
        { kind: "group-member", botId: "departing-bot", threadId: "group-thread" },
        3,
      );
      expect(findMany).not.toHaveBeenCalled();
      expect(purgeHistory.mock.calls.map(([request]) => request)).toEqual(
        byThread ? [{ botId: "departing-bot", threadId: "group-thread", generations: [2, 3] }] : [],
      );
    },
  );

  it("purges the bot of a direct chat without learned turns", async () => {
    const target = { kind: "bot", botId: "bot-1", threadId: "thread-2" } as ThreadTarget;
    await purgeClearedThreadMemory(depsWith({ purgeHistory }), actor, target, 0);
    expect(purgeHistory).toHaveBeenCalledTimes(1);
    expect(purgeHistory.mock.calls[0]?.[0]).toEqual({
      botId: "bot-1",
      threadId: "thread-2",
      generations: [0, 0],
    });
  });

  it("keeps purging the other bots when one purge fails", async () => {
    purgeHistory.mockImplementation(async ({ botId }: { botId: string }) => {
      if (botId === "bot-1") return { ok: false, error: "nope" };
      if (botId === "bot-2") throw new Error("boom");
      return { ok: true };
    });
    await expect(
      purgeClearedThreadMemory(depsWith(byThread), actor, group, 1),
    ).resolves.toBeUndefined();
    expect(purgeHistory).toHaveBeenCalledTimes(3);
  });

  it("still purges the current members when the bots that ran there can't be listed", async () => {
    findMany.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      purgeClearedThreadMemory(depsWith(byThread), actor, group, 1),
    ).resolves.toBeUndefined();
    expect(purgeHistory.mock.calls.map(([request]) => request.botId).sort()).toEqual([
      "bot-1",
      "bot-2",
    ]);
  });

  it("queues failed purges with the original connection and cleared generations", async () => {
    const deps = depsWith({ ...byThread, connectionIdentity: "connection-1" });
    purgeHistory.mockResolvedValueOnce({ ok: false, error: "cleanup deadline" });
    await purgeClearedThreadMemory(deps, actor, group, 3);
    expect(deps.jobs.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "memory.purge-history",
        maxAttempts: 12,
        payload: {
          ...actor,
          botId: "bot-1",
          threadId: "thread-1",
          generations: [2, 3],
          connectionIdentity: "connection-1",
        },
      }),
    );
  });
});

vi.mock("./shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared.js")>()),
  modelSetup: vi.fn(async () => ({ needsModel: false, hasDeployment: false })),
}));
vi.mock("../taught-skills.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../taught-skills.js")>()),
  assertTeachingSendAllowed: vi.fn(),
}));

function intakeFixture(spawnKey = "pm:roof") {
  const tx = {
    artifact: {
      findMany: vi.fn(async () => [
        { id: "artifact-1", name: "Plan.pdf", mimeType: "application/pdf", size: 4 },
      ]),
    },
    space: { findUnique: vi.fn(async () => ({ isDefault: false, deletingAt: null })) },
    spaceMember: {
      findUnique: vi.fn(async () => ({ role: "member" })),
      count: vi.fn(async () => 1),
    },

    bot: {
      findFirst: vi.fn(async () => ({
        id: "bot",
        spawnKey,
        thread: { id: "thread" },
        computer: null,
      })),
    },
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
  const stageProjectIntake = vi.fn<NonNullable<RouterDeps["stageProjectIntake"]>>(async () => ({
    intakeId: "intake-1",
    files: [{ id: "file-1", status: "processing" }],
  }));
  const handler = new RPCHandler(
    createRouter({
      prisma,
      stageProjectIntake,
      env: {
        webOrigin: "http://127.0.0.1",
        agentRuntime: "scripted",
        maxAttachmentsPerMessage: 10,
      },
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    } as unknown as RouterDeps),
  );
  const send = async (
    artifactIds?: string[],
    extra: Record<string, unknown> = {},
    status = 200,
  ) => {
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/threads/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: { botId: "bot", text: "Review this", artifactIds, ...extra },
        }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    expect(response?.status).toBe(status);
  };
  return { tx, stageProjectIntake, send };
}

describe("PM chat attachment intake", () => {
  it("stages once before the model turn and keeps the note out of stored blocks", async () => {
    const f = intakeFixture();
    await f.send(["artifact-1"]);
    expect(f.stageProjectIntake).toHaveBeenCalledExactlyOnceWith(actor, {
      projectId: "roof",
      botId: "bot",
      artifactIds: ["artifact-1"],
      idempotencyKey: undefined,
      signal: expect.any(AbortSignal),
    });
    expect(f.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt:
            'Review this\n\nAttached files were received for review in Vendor One intake intake-1 (1 files). Acknowledge receipt for review and ask one question at a time. Do not claim the documents are published or approved.\n\nUser attached file "Plan.pdf" (application/pdf, 4 bytes).',
        }),
      }),
    );
    expect(f.tx.message.create.mock.calls[0]?.[0].data.blocks).toEqual([
      { kind: "text", text: "Review this" },
      {
        kind: "file",
        artifactId: "artifact-1",
        name: "Plan.pdf",
        mimeType: "application/pdf",
        size: 4,
      },
    ]);
    expect(f.stageProjectIntake.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.task.create.mock.invocationCallOrder[0]!,
    );
  });
  it("does not stage for a non-PM bot", async () => {
    const f = intakeFixture("other:roof");
    await f.send(["artifact-1"]);
    expect(f.stageProjectIntake).not.toHaveBeenCalled();
  });
  it("does not stage without artifacts", async () => {
    const f = intakeFixture();
    await f.send();
    expect(f.stageProjectIntake).not.toHaveBeenCalled();
  });
  it("still sends with the failure note when staging fails", async () => {
    const f = intakeFixture();
    f.stageProjectIntake.mockRejectedValueOnce(new Error("unavailable"));
    await f.send(["artifact-1"]);
    expect(f.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt:
            'Review this\n\nAttachment staging failed; the files remain in this chat. Tell the user to retry. Do not claim the files were received for review, reviewed, published or approved.\n\nUser attached file "Plan.pdf" (application/pdf, 4 bytes).',
        }),
      }),
    );
  });
});

it("skips staging for a replayed nonce", async () => {
  const f = intakeFixture();
  f.tx.message.findUnique.mockResolvedValueOnce({ id: "saved" } as never);
  await f.send(["artifact-1"], { clientNonce: "send-1" });
  expect(f.stageProjectIntake).not.toHaveBeenCalled();
  expect(f.tx.message.findUnique).toHaveBeenCalledWith({
    where: { threadId_clientNonce: { threadId: "thread", clientNonce: "send-1" } },
  });
});
it("skips staging for image confirmation", async () => {
  const f = intakeFixture();
  await f.send(["artifact-1"], { imageHandling: "confirm" });
  expect(f.stageProjectIntake).not.toHaveBeenCalled();
});
it("skips staging over the attachment limit", async () => {
  const f = intakeFixture();
  const artifacts = Array.from({ length: 11 }, (_, index) => ({
    id: `artifact-${index}`,
    name: "Plan.pdf",
    mimeType: "application/pdf",
    size: 4,
  }));
  f.tx.artifact.findMany.mockResolvedValueOnce(artifacts);
  await f.send(
    artifacts.map(({ id }) => id),
    {},
    400,
  );
  expect(f.stageProjectIntake).not.toHaveBeenCalled();
});
it("passes the send nonce as the intake idempotency key", async () => {
  const f = intakeFixture();
  await f.send(["artifact-1"], { clientNonce: "send-1" });
  expect(f.stageProjectIntake).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({ idempotencyKey: "send-1" }),
  );
});
it.each([
  ["FORBIDDEN", "access denied", "Access denied"],
  ["CONFLICT", "personal", "personal or unbound"],
  ["CONFLICT", "unbound", "personal or unbound"],
  ["CONFLICT", "binding_missing", "reload or rebind"],
  ["CONFLICT", "binding_stale", "reload or rebind"],
  ["NOT_FOUND", "project_unavailable", "project is unavailable"],
  ["BAD_GATEWAY", "secret upstream details", "Tell the user to retry"],
] as const)("supplies honest failure guidance for %s %s", async (code, message, guidance) => {
  const f = intakeFixture();
  f.stageProjectIntake.mockRejectedValueOnce(new ORPCError(code, { message }));
  await f.send(["artifact-1"]);
  expect(f.tx.task.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ prompt: expect.stringContaining(guidance) }),
    }),
  );
});
it("bounds a stalled staging dependency and sends the failure note", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementationOnce((ms) => {
    expect(ms).toBe(45_000);
    return AbortSignal.timeout(1);
  });
  try {
    const f = intakeFixture();
    f.stageProjectIntake.mockImplementationOnce(async () => new Promise(() => {}));
    await f.send(["artifact-1"]);
    expect(f.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: expect.stringContaining("Attachment staging failed"),
        }),
      }),
    );
  } finally {
    timeout.mockRestore();
  }
});
