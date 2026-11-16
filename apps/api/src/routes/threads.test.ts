import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerComputerRequest } from "../computer-control.js";
import type { RouterDeps } from "../router.js";
import type * as TaughtModule from "../taught-skills.js";
import { purgeClearedThreadMemory } from "../thread-memory.js";
import type * as ThreadTargetModule from "../thread-target.js";
import type { ThreadTarget } from "../thread-target.js";
import { resolveThreadTarget, sendThreadMessage } from "../thread-target.js";
import type { RouterContext } from "./context.js";
import type * as SharedModule from "./shared.js";
import { takeoverReleaser, threadsRoutes } from "./threads.js";

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
  ...(await importOriginal<typeof SharedModule>()),
  modelSetup: vi.fn(async () => ({ needsModel: false, hasDeployment: false })),
}));
vi.mock("../taught-skills.js", async (importOriginal) => ({
  ...(await importOriginal<typeof TaughtModule>()),
  assertTeachingSendAllowed: vi.fn(),
}));
vi.mock("../thread-target.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreadTargetModule>()),
  resolveThreadTarget: vi.fn(),
  sendThreadMessage: vi.fn(),
}));

describe("PM attachment staging on send", () => {
  const note =
    "Attachments were received and are being staged in Vendor One. Acknowledge and say you will review them once ready. Do not claim publication or approval.";
  function fixture(spawnKey: string | null = "pm:project") {
    vi.mocked(resolveThreadTarget).mockResolvedValue({
      kind: "bot",
      botId: "bot",
      threadId: "thread",
      bot: { name: "Roof - PM", spawnKey },
    } as ThreadTarget);
    vi.mocked(sendThreadMessage)
      .mockReset()
      .mockResolvedValue({ runId: "run" } as never);
    const jobs = { enqueue: vi.fn(async (_job: unknown) => undefined) };
    const procedure = { handler: (handler: unknown) => handler };
    const authed = new Proxy({}, { get: () => new Proxy({}, { get: () => procedure }) });
    const findUnique = vi.fn().mockResolvedValue({
      blocks: [{ kind: "file", artifactId: "file", name: "file", mimeType: "text/plain", size: 1 }],
    });
    const routes = threadsRoutes({
      deps: { jobs, env: {}, prisma: { message: { findUnique } } },
      authed,
      callsEnabled: authed,
    } as unknown as RouterContext);
    const send = routes.threads.send as unknown as (args: {
      context: { actor: Actor };
      input: { text: string; botId: string; artifactIds?: string[]; clientNonce?: string };
    }) => Promise<unknown>;
    return {
      jobs,
      findUnique,
      send: (input: { artifactIds?: string[]; clientNonce?: string } = {}) =>
        send({
          context: { actor },
          input: { text: "Please review", botId: "bot", ...input },
        }),
    };
  }
  it("enqueues after a successful send and supplies the static note", async () => {
    const { send, jobs } = fixture();
    vi.mocked(sendThreadMessage).mockImplementationOnce(async () => {
      expect(jobs.enqueue).not.toHaveBeenCalled();
      return { runId: "run" } as never;
    });
    await expect(send({ artifactIds: ["file"], clientNonce: "nonce" })).resolves.toEqual({
      runId: "run",
    });
    expect(sendThreadMessage).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.anything(),
      expect.objectContaining({ stagingNote: note }),
      expect.any(Function),
      undefined,
    );
    expect(jobs.enqueue).toHaveBeenCalledWith({
      name: "project.intake.stage",
      payload: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: "bot",
        threadId: "thread",
        artifactIds: ["file"],
        projectId: "project",
        projectName: "Roof - PM",
        idempotencyKey: "nonce",
      },
      replaceKey: "project.intake.stage:thread:nonce",
      keepExisting: true,
      maxAttempts: 8,
    });
  });
  it("replays use the same deduplication key", async () => {
    const { send, jobs } = fixture();
    await send({ artifactIds: ["file"], clientNonce: "nonce" });
    await send({ artifactIds: ["file"], clientNonce: "nonce" });
    expect(jobs.enqueue.mock.calls[0]).toEqual(jobs.enqueue.mock.calls[1]);
  });
  it("does not stage request artifacts when replaying a text-only nonce", async () => {
    const { send, jobs, findUnique } = fixture();
    findUnique.mockResolvedValue({ blocks: [{ kind: "text", text: "Hello" }] });
    await send({ artifactIds: ["unexpected"], clientNonce: "nonce" });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({
      where: { threadId_clientNonce: { threadId: "thread", clientNonce: "nonce" } },
      select: { blocks: true },
    });
  });
  it.each([["different"], undefined])(
    "stages persisted attachments on replay with request IDs %s",
    async (artifactIds) => {
      const { send, jobs } = fixture();
      await send({ artifactIds, clientNonce: "nonce" });
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ artifactIds: ["file"] }),
        }),
      );
    },
  );
  it("generates a submission key when the caller has no nonce", async () => {
    const { send, jobs } = fixture();
    await send({ artifactIds: ["file"] });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      }),
    );
  });
  it.each([null, "setup:client", "pm:"])("skips bots without a project: %s", async (spawnKey) => {
    const { send, jobs } = fixture(spawnKey);
    await send({ artifactIds: ["file"] });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(vi.mocked(sendThreadMessage).mock.calls[0]?.[3].stagingNote).toBeUndefined();
  });
  it("skips messages without attachments", async () => {
    const { send, jobs } = fixture();
    await send();
    await send({ artifactIds: [] });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
  it("skips group sends", async () => {
    const { send, jobs } = fixture();
    vi.mocked(resolveThreadTarget).mockResolvedValue({
      kind: "group",
      threadId: "thread",
      memberBotIds: [],
    } as unknown as ThreadTarget);
    await send({ artifactIds: ["file"] });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
  it("does not enqueue after a failed send", async () => {
    const { send, jobs } = fixture();
    vi.mocked(sendThreadMessage).mockRejectedValueOnce(new Error("send failed"));
    await expect(send({ artifactIds: ["file"] })).rejects.toThrow("send failed");
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
  it("keeps a successful send successful when enqueue fails", async () => {
    const { send, jobs } = fixture();
    jobs.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(send({ artifactIds: ["file"] })).resolves.toEqual({ runId: "run" });
  });
});
