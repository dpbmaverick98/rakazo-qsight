import type {
  AgentHomeStore,
  AgentRuntime,
  ArtifactStore,
  BackgroundJobAttempt,
  BackgroundJobExecution,
  BackgroundJobHandlers,
  BackgroundJobPayloads,
  JobPublisher,
  MediaGenerationProvider,
  PaymentWalletProvider,
  SandboxProvider,
  SecretStore,
} from "@rakazo/adapter-kit";
import {
  memoryRetainTurnJob,
  memoryRetainTurnRecoveryJobKey,
  SandboxRateLimitError,
  SandboxUnavailableError,
  SandboxUnresponsiveError,
} from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { settleCallRequest } from "./call-request.js";
import type { CloudAgentConnection, UserCloudAgents } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import { expireComputerControl, scheduleComputerControlExpiry } from "./computer-control.js";
import { rateLimitEnds, scheduleComputerSleep, sleepComputerIfIdle } from "./computer-idle.js";
import { performComputerUpdate } from "./computer-update.js";
import {
  abandonRetainedConversation,
  retainRunConversation,
  settleRetainedConversation,
} from "./conversation-memory.js";
import { retryConversationMemoryPurge } from "./conversation-memory-cleanup.js";
import type { createRunExecutor } from "./executor.js";
import type { ExpoPushProvider } from "./expo-push.js";
import { compactHistory } from "./history-compaction.js";
import { pollMediaVideo } from "./media-video-poll.js";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import type { MessagingDelivery } from "./messaging-delivery.js";
import type { ProjectIntakeSummary } from "./project-intake-staging.js";
import { pollPurchase } from "./purchase-poll.js";
import { retrySecretCleanup } from "./secret-cleanup.js";
import { expireTaughtSkillTeaching } from "./teaching-session.js";
import type { TeamChat } from "./team-chat.js";

type Tenant = { spaceId: string; userId: string };

/**
 * A job that acts for one run, routine, computer, skill, thread, cloud agent or purchase runs
 * as that row's tenant, so row-level security keeps it, and every tool it runs, in
 * the owner's Space even where a query forgets to filter. Normally the owner comes from one
 * narrow system read. Server-created cleanup intent can capture that tenant before deletion.
 */
function asOwner<Key, P extends Key>(
  owner: (payload: Key) => Promise<Tenant | null>,
  handler: (
    payload: P,
    execution: BackgroundJobExecution | undefined,
    tenant: Tenant,
    attempt?: BackgroundJobAttempt,
  ) => Promise<void>,
): (
  payload: P,
  execution?: BackgroundJobExecution,
  attempt?: BackgroundJobAttempt,
) => Promise<void> {
  return async (payload, execution, attempt) => {
    const tenant = await runAsSystem("find the tenant a background job acts for", () =>
      owner(payload),
    );
    if (tenant) await runAsTenant(tenant, () => handler(payload, execution, tenant, attempt));
  };
}

const OWNER = { spaceId: true, userId: true } as const;
const CONTROL_EXPIRE_RETRY_MS = 30_000;
/**
 * How long to wait before asking again whether the memory provider stored a turn: 5 s, doubling
 * up to 10 min. 150 checks wait about 24 h in all, long enough for a backed-up provider.
 */
const RETAIN_TURN_FIRST_CHECK_MS = 5_000;
const RETAIN_TURN_MAX_CHECK_MS = 10 * 60_000;
const MAX_RETAIN_TURN_CHECKS = 150;

export function createBackgroundJobHandlers(deps: {
  executor: ReturnType<typeof createRunExecutor>;
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  jobs: JobPublisher;
  events: ThreadEvents;
  workerId: string;
  runtime: AgentRuntime;
  secretStore: SecretStore;
  memoryProviders: MemoryProviderResolver;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
  messagingDelivery?: MessagingDelivery;
  teamChat?: TeamChat;
  cloudAgent?: CloudAgentConnection | null;
  userCloudAgents?: UserCloudAgents;
  paymentWallet?: PaymentWalletProvider | null;
  notifications?: ExpoPushProvider;
  mediaGeneration?: MediaGenerationProvider;
  maxUploadSizeBytes?: number;
  projectIntakeStage?: (
    payload: BackgroundJobPayloads["project.intake.stage"],
  ) => Promise<ProjectIntakeSummary>;
}): BackgroundJobHandlers {
  const delivery = deps.messagingDelivery;
  const cleanupDeps = { prisma: deps.prisma, secrets: deps.secretStore };
  const run = ({ runId }: { runId: string }) =>
    deps.prisma.run.findUnique({ where: { id: runId }, select: OWNER });
  const routine = ({ routineId }: { routineId: string }) =>
    deps.prisma.routine.findUnique({ where: { id: routineId }, select: OWNER });
  const computer = ({ computerId }: { computerId: string }) =>
    deps.prisma.computer.findUnique({ where: { id: computerId }, select: OWNER });
  const thread = ({ threadId }: { threadId: string }) =>
    deps.prisma.thread.findUnique({ where: { id: threadId }, select: OWNER });
  const skill = ({ skillId }: { skillId: string }) =>
    deps.prisma.taughtSkill.findUnique({ where: { id: skillId }, select: OWNER });
  const cloudAgent = ({ agentId }: { agentId: string }) =>
    deps.prisma.cloudAgent.findUnique({ where: { id: agentId }, select: OWNER });
  const purchase = ({ purchaseId }: { purchaseId: string }) =>
    deps.prisma.purchase.findUnique({ where: { id: purchaseId }, select: OWNER });
  const mediaJob = async ({ jobId }: { jobId: string }) =>
    (
      await deps.prisma.externalEffect.findUnique({
        where: { id: jobId },
        select: { run: { select: OWNER } },
      })
    )?.run ?? null;
  const updatedComputer = async ({ updateId }: { updateId: string }) =>
    (
      await deps.prisma.computerUpdate.findUnique({
        where: { id: updateId },
        select: { computer: { select: OWNER } },
      })
    )?.computer ?? null;

  return {
    "project.intake.stage": asOwner(thread, async (payload, _execution, tenant, attempt) => {
      if (tenant.spaceId !== payload.spaceId) return;
      const target = await deps.prisma.thread.findFirst({
        where: {
          id: payload.threadId,
          spaceId: tenant.spaceId,
          botId: payload.botId,
          bot: { spaceId: tenant.spaceId, spawnKey: `pm:${payload.projectId}`, archivedAt: null },
        },
        select: { id: true },
      });
      if (!target) return;
      const clientNonce = `project.intake.stage:${payload.idempotencyKey}`;
      // The thread lock serializes completion notices across retries and duplicate deliveries.
      if (
        await deps.prisma.message.findUnique({
          where: { threadId_clientNonce: { threadId: payload.threadId, clientNonce } },
          select: { id: true },
        })
      )
        return;
      let text: string;
      let receipt:
        | { intakeId: string; intakeRevision: number; projectId: string; fileCount: number }
        | undefined;
      try {
        if (!deps.projectIntakeStage) throw new Error("disabled");
        const result = await deps.projectIntakeStage(payload);
        receipt = {
          intakeId: result.intakeId,
          intakeRevision: result.intakeRevision,
          projectId: payload.projectId,
          fileCount: result.files.length,
        };
        text = `Staged ${receipt.fileCount} file(s) for review`;
      } catch (error) {
        const category = error instanceof Error ? error.message : "";
        const guidance: Record<string, string> = {
          forbidden: "Access denied. Ask the client administrator to restore access.",
          personal: "Choose a bound client workspace before sending project files.",
          unbound: "Choose a bound client workspace before sending project files.",
          binding_missing:
            "The client binding is missing. Ask the client administrator to bind this workspace.",
          binding_stale: "The client binding changed. Refresh the project and try again.",
          project_unavailable: "The project is unavailable. Refresh the project and try again.",
          space_unavailable: "The workspace is unavailable. Refresh the workspace and try again.",
          disabled: "File staging is unavailable. Please try again later.",
        };
        const advice = Object.hasOwn(guidance, category) ? guidance[category] : undefined;
        if (!advice && attempt && attempt.number < attempt.max) throw error;
        text = `Files could not be staged. ${advice ?? "Please retry sending the files."} The files are not ready; do not claim review.`;
      }
      const committed = await deps.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${payload.threadId} FOR UPDATE`;
        if (
          await tx.message.findUnique({
            where: { threadId_clientNonce: { threadId: payload.threadId, clientNonce } },
            select: { id: true },
          })
        )
          return false;
        const blocks = [
          {
            kind: "text" as const,
            text,
            ...(receipt ? { inspectionContext: JSON.stringify({ intakeReceipt: receipt }) } : {}),
          },
        ];
        const message = await createThreadMessageInTransaction(tx, {
          threadId: payload.threadId,
          botId: payload.botId,
          role: "bot",
          blocks,
          clientNonce,
        });
        const event = await appendEventInTransaction(tx, {
          spaceId: tenant.spaceId,
          threadId: payload.threadId,
          botId: payload.botId,
          type: "thread.message.created",
          payload: { messageId: message.id, seq: message.seq, role: "bot", blocks },
        });
        return event;
      });
      if (committed) {
        await deps.events.notify(payload.threadId, committed.seq);
        await deps.events.publishSpaceChange?.(tenant.spaceId, "runs");
      }
    }),
    "run.continue": asOwner(run, async (payload, execution, { spaceId }) => {
      try {
        if (execution)
          await deps.executor.continueRun(payload.runId, deps.workerId, execution.onRunStarted);
        else await deps.executor.continueRun(payload.runId, deps.workerId);
      } finally {
        // Whatever this turn did to its run (waited, paused, requeued, ended), apps read it again.
        await deps.events.publishSpaceChange?.(spaceId, "runs");
      }
      // The process that ran the turn sends what it said straight away. An ended run's reply
      // job, scheduled with its status, covers a failure here; it never fails the run.
      await delivery?.deliverRun(payload.runId).catch((error) => {
        delivery.reportFailure("messaging reply delivery error", error);
      });
    }),
    "messaging.send": async ({ outboundId }, _execution, attempt) => {
      await delivery?.sendJob(outboundId, attempt);
    },
    "messaging.reply": async ({ runId }) => {
      await delivery?.deliverRun(runId);
    },
    "secret.cleanup": async (cleanup) => {
      await retrySecretCleanup(cleanupDeps, cleanup);
    },
    // The previous release's jobs, drained once by this one.
    "messaging.credential-cleanup": async ({ installationId, ref }) => {
      await retrySecretCleanup(cleanupDeps, {
        kind: "messaging_installation",
        recordId: installationId,
        ref,
      });
    },
    "messaging.deliver": async ({ runId }) => {
      if (runId) await delivery?.deliverRun(runId);
      await delivery?.drainAll();
    },
    "messaging.progress": async ({ runId }) => {
      await delivery?.deliverRun(runId, { progress: true });
    },
    "team_chat.engage": async ({ externalMessageId }) => {
      await deps.teamChat?.engageJob(externalMessageId);
    },
    "team_chat.ambient": async ({ conversationId }) => {
      await deps.teamChat?.ambientJob(conversationId);
    },
    "routine.wakeup": asOwner(routine, async (payload, _execution, { spaceId }) => {
      try {
        await deps.executor.wakeRoutine(payload.routineId, payload.scheduledFor);
      } finally {
        // A wake moves the routine's next run, or pauses it, and may queue or coalesce runs.
        await deps.events.publishSpaceChange?.(spaceId, "routines");
        await deps.events.publishSpaceChange?.(spaceId, "runs");
      }
    }),
    "routine.retry": asOwner(run, async (payload, _execution, { spaceId }) => {
      try {
        await deps.executor.retryRoutineRun(payload.runId);
      } finally {
        await deps.events.publishSpaceChange?.(spaceId, "runs");
      }
    }),
    "computer.update": asOwner(updatedComputer, async ({ updateId }) => {
      await performComputerUpdate(deps, updateId);
    }),
    "computer.sleep": asOwner(computer, async (payload) => {
      await sleepComputerIfIdle(deps, payload.computerId);
    }),
    "computer.control-expire": asOwner(computer, async ({ computerId, leaseId }) => {
      try {
        if (await expireComputerControl(deps, computerId, leaseId)) {
          scheduleComputerSleep(deps.jobs, computerId);
        }
      } catch (error) {
        // Input is already denied and the lease kept, so a provider outage only delays the release.
        if (
          !(error instanceof SandboxUnresponsiveError) &&
          !(error instanceof SandboxUnavailableError) &&
          !(error instanceof SandboxRateLimitError)
        )
          throw error;
        getLogger().warn("computer.control_expire_deferred", { "computer.id": computerId, error });
        await scheduleComputerControlExpiry(
          deps.jobs,
          computerId,
          leaseId,
          rateLimitEnds(error) ?? new Date(Date.now() + CONTROL_EXPIRE_RETRY_MS),
        );
      }
    }),
    "skill.teaching-expire": asOwner(skill, async (payload) => {
      await expireTaughtSkillTeaching(deps, payload.skillId);
    }),
    "call.expire": asOwner(thread, async (payload) => {
      await settleCallRequest(deps, { ...payload, from: ["ringing"], status: "missed" });
    }),
    "cloud_agent.poll": asOwner(cloudAgent, async (payload) => {
      await pollCloudAgent(
        {
          prisma: deps.prisma,
          jobs: deps.jobs,
          events: deps.events,
          cloudAgent: deps.cloudAgent,
          userCloudAgents: deps.userCloudAgents,
        },
        payload,
      );
    }),
    "purchase.poll": asOwner(purchase, async (payload) => {
      await pollPurchase(
        {
          prisma: deps.prisma,
          secretStore: deps.secretStore,
          jobs: deps.jobs,
          paymentWallet: deps.paymentWallet,
        },
        payload,
      );
    }),
    "media.poll": asOwner(mediaJob, async (payload) => {
      await pollMediaVideo(deps, payload);
    }),
    // A receipt belongs to a device's push token, not to a Space.
    "push.receipt": async (payload) => {
      await runAsSystem("check a push receipt", () => deps.notifications?.checkReceipt(payload));
    },
    "history.compact": asOwner(thread, async (payload) => {
      // Retrieval policies use stored context without paid message-count compaction.
      // Skip legacy backlog work after a policy change.
      if (deps.executor.contextStrategy && deps.executor.contextStrategy !== "current") return;
      await compactHistory(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          jobs: deps.jobs,
          memoryProviders: deps.memoryProviders,
          deploymentModelKey: deps.deploymentModelKey,
          deploymentModelConfigured: deps.deploymentModelConfigured,
          ...(deps.executor.resolveModel ? { resolveModel: deps.executor.resolveModel } : {}),
        },
        payload.threadId,
        payload.userId,
      );
    }),
    "memory.purge-history": asOwner(
      async (payload: BackgroundJobPayloads["memory.purge-history"]) => payload,
      async (payload) => retryConversationMemoryPurge(deps, payload),
    ),
    "memory.retain-turn": asOwner(
      async (payload: BackgroundJobPayloads["memory.retain-turn"]) =>
        // Source was captured from the run before submission; group deletion may remove that row.
        payload.pending ? payload.pending.source : run(payload),
      async (payload) => {
        const memory = {
          prisma: deps.prisma,
          memoryProviders: deps.memoryProviders,
          jobs: deps.jobs,
        };
        let next: NonNullable<BackgroundJobPayloads["memory.retain-turn"]["pending"]>;
        if (!payload.pending) {
          const { pending } = await retainRunConversation(
            memory,
            payload.runId,
            payload.messageIds,
          );
          if (!pending) return;
          next = { ...pending, checks: 0 };
        } else {
          // Never rebuild the turn: a clear may have deleted its messages meanwhile.
          const { settled } = await settleRetainedConversation(
            memory,
            payload.runId,
            payload.pending,
          ).catch((error) => {
            // A failed status check or post-clear purge uses the same bounded backoff.
            getLogger().error("memory.retain-turn settlement failed", error);
            return { settled: false };
          });
          if (settled) return;
          next = { ...payload.pending, checks: payload.pending.checks + 1 };
          if (next.checks >= MAX_RETAIN_TURN_CHECKS) {
            getLogger().warn(
              "memory.retain-turn gave up waiting for the provider to store the turn",
              {
                "run.id": payload.runId,
              },
            );
            await abandonRetainedConversation(memory, payload.runId, next);
            return;
          }
        }
        // Not settled yet: check again later instead of holding a worker.
        await deps.jobs.enqueue(
          memoryRetainTurnJob(payload.runId, payload.messageIds, {
            pending: next,
            availableAt: new Date(
              Date.now() +
                Math.min(RETAIN_TURN_FIRST_CHECK_MS * 2 ** next.checks, RETAIN_TURN_MAX_CHECK_MS),
            ),
          }),
        );
        if (!payload.pending) {
          // Cancel only after the confirmed handoff is durable. An already running recovery
          // may requeue itself, but its separate key cannot erase the token and its budget ends.
          await deps.jobs.cancel(memoryRetainTurnRecoveryJobKey(payload.runId)).catch((error) => {
            getLogger().error("memory.retain-turn recovery cancellation failed", error);
          });
        }
      },
    ),
  };
}
