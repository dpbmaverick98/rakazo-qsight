import { phoneCallSettings, resolveEncryptionKey, uploadSizeFromEnv } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundJobHandlers } from "./background-job-handlers.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import { deploymentLabsFromEnv } from "./labs-env.js";
import { mcpStdioOptionsFromEnv } from "./mcp-connector.js";
import { qsightHierarchyFromEnv } from "./qsight-hierarchy.js";
import { createRunRuntime, runRuntimeEnvFromProcess } from "./run-runtime.js";

// What the worker read inline before it shared the runtime builder with the API.
function previousWorkerValues(source: NodeJS.ProcessEnv) {
  const { key, configured, provider, model } = resolveDeploymentModel(source);
  return {
    dataDir: source.DATA_DIR ?? "./data",
    encryptionKey: resolveEncryptionKey(source),
    composioApiKey: source.COMPOSIO_API_KEY,
    cursorApiKey: source.CURSOR_API_KEY,
    deploymentModelKey: key,
    deploymentModelConfigured: configured,
    // The API's ambient team-chat judge settings, which the worker's jobs now use too.
    defaultProvider: provider,
    defaultModel: model,
    teamChatJudgeProvider: source.TEAM_CHAT_JUDGE_PROVIDER?.trim() || undefined,
    teamChatJudgeModel: source.TEAM_CHAT_JUDGE_MODEL?.trim() || undefined,
    mcpStdioEnabled: source.MCP_STDIO_ENABLED === "true",
    mcpStdioAllowedCommands: (source.MCP_STDIO_ALLOWED_COMMANDS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    mcpStdio: mcpStdioOptionsFromEnv(source),
    mcpAllowPrivateEndpoint: source.MCP_ALLOW_PRIVATE_ENDPOINT === "true",
    pipedreamClientId: source.PIPEDREAM_CLIENT_ID,
    pipedreamClientSecret: source.PIPEDREAM_CLIENT_SECRET,
    pipedreamProjectId: source.PIPEDREAM_PROJECT_ID,
    pipedreamEnvironment: source.PIPEDREAM_ENVIRONMENT,
    deploymentLabs: deploymentLabsFromEnv(source),
    ...phoneCallSettings(source),
    maxUploadSizeBytes: uploadSizeFromEnv(source),
    inboundEmailDomain: source.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || undefined,
  };
}

describe("runRuntimeEnvFromProcess", () => {
  it.each<NodeJS.ProcessEnv>([
    { NODE_ENV: "test" },
    {
      NODE_ENV: "test",
      DATA_DIR: "/var/rakazo",
      ENCRYPTION_KEY: "offline-encryption-key-at-least-32-chars",
      COMPOSIO_API_KEY: " composio-key ",
      CURSOR_API_KEY: " cursor-key ",
      PI_DEFAULT_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "openrouter-key",
      MCP_STDIO_ENABLED: "true",
      MCP_STDIO_ALLOWED_COMMANDS: " npx, uvx ,,",
      MCP_STDIO_IDLE_MS: "1000",
      MCP_ALLOW_PRIVATE_ENDPOINT: "true",
      PIPEDREAM_CLIENT_ID: " client ",
      PIPEDREAM_CLIENT_SECRET: "secret",
      PIPEDREAM_PROJECT_ID: "project",
      PIPEDREAM_ENVIRONMENT: "production",
      TICKET_BOARD_ENABLED: "true",
      PHONE_CALLS_ENABLED: "true",
      PHONE_CALL_RING_SECONDS: "30",
      MAX_UPLOAD_SIZE_MB: "20",
      INBOUND_EMAIL_DOMAIN: " Bots.Example.Test ",
      TEAM_CHAT_JUDGE_PROVIDER: " openrouter ",
      TEAM_CHAT_JUDGE_MODEL: "small-model",
    },
    { NODE_ENV: "test", INBOUND_EMAIL_DOMAIN: "  ", PIPEDREAM_ENVIRONMENT: "staging" },
  ])("reads the values the worker read before (%#)", (source) => {
    expect(runRuntimeEnvFromProcess(source)).toEqual(previousWorkerValues(source));
  });
});

vi.mock("./background-job-handlers.js", () => ({ createBackgroundJobHandlers: vi.fn(() => ({})) }));
vi.mock("./executor.js", () => ({ createRunExecutor: vi.fn(() => ({})) }));
vi.mock("./cli-models/runtime.js", () => ({ cliModelRuntime: vi.fn((_env, runtime) => runtime) }));
vi.mock("./qsight-hierarchy.js", () => ({ qsightHierarchyFromEnv: vi.fn(() => null) }));

describe("runtime project intake composition", () => {
  afterEach(() => vi.unstubAllGlobals());
  const payload = {
    spaceId: "space",
    userId: "sender",
    botId: "bot",
    threadId: "thread",
    artifactIds: ["artifact"],
    projectId: "project",
    projectName: "Project",
    idempotencyKey: "nonce",
  };
  function fixture(configured = true) {
    let revision = 1;
    const source = {
      read: vi.fn(async () => ({
        client: { id: "client" },
        buildings: [{ projects: [{ id: "project" }] }],
      })),
      managerServer: vi.fn(async () => ({
        tokenId: "token-id",
        headers: { Authorization: "Bearer scoped-token" },
      })),
      revokeManagerToken: vi.fn(async () => undefined),
      createIntake: vi.fn(async () => ({
        id: "intake",
        files: [
          {
            id: "file",
            client_id: "artifact",
            status: "pending",
            upload_url: "https://upload.invalid",
          },
        ],
      })),
      completeIntakeFile: vi.fn(async () => ({ status: "ready" })),
    };
    vi.mocked(qsightHierarchyFromEnv).mockReturnValue(
      configured
        ? (source as unknown as NonNullable<ReturnType<typeof qsightHierarchyFromEnv>>)
        : null,
    );
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ email: "sender@example.test" })) },
      spaceMember: { findUnique: vi.fn(async () => ({ role: "member" })) },
      space: { findUnique: vi.fn(async () => ({ isDefault: false })) },
      spaceClientBinding: {
        findUnique: vi.fn(async () => ({ active: true, externalClientId: "client", revision })),
      },
      artifact: {
        findFirst: vi.fn(async () => ({
          id: "artifact",
          storageKey: "private-key",
          name: "file.txt",
          mimeType: "text/plain",
        })),
      },
    };
    const artifacts = { get: vi.fn(async () => Buffer.from("file contents")) };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    createRunRuntime(
      {} as Parameters<typeof createRunRuntime>[0],
      { stack: { connector: {} } } as Parameters<typeof createRunRuntime>[1],
      { prisma, artifacts, runtime: {} } as unknown as Parameters<typeof createRunRuntime>[2],
    );
    const callback = vi
      .mocked(createBackgroundJobHandlers)
      .mock.calls.at(-1)![0].projectIntakeStage;
    return {
      callback,
      source,
      prisma,
      artifacts,
      rebind: () => {
        revision++;
      },
    };
  }
  it("omits staging when QSight is not configured", () => {
    expect(fixture(false).callback).toBeUndefined();
  });
  it("reads only the bot's artifacts in its space and stages with a scoped token", async () => {
    const { callback, prisma, artifacts, source } = fixture();
    await expect(callback!(payload)).resolves.toEqual({
      intakeId: "intake",
      files: [{ id: "file", status: "ready" }],
    });
    expect(prisma.artifact.findFirst).toHaveBeenCalledWith({
      where: {
        id: "artifact",
        botId: "bot",
        groupId: null,
        spaceId: "space",
      },
    });
    expect(artifacts.get).toHaveBeenCalledWith(
      "private-key",
      expect.objectContaining({
        spaceId: "space",
        userId: "sender",
        botId: "bot",
      }),
    );
    expect(source.createIntake).toHaveBeenCalledWith(
      "project",
      expect.any(Array),
      expect.any(String),
      "scoped-token",
    );
    expect(source.revokeManagerToken).toHaveBeenCalledWith("token-id");
  });
  it("rechecks the binding after hierarchy reads", async () => {
    const { callback, source, rebind } = fixture();
    source.read.mockImplementationOnce(async () => {
      rebind();
      return { client: { id: "client" }, buildings: [{ projects: [{ id: "project" }] }] };
    });
    await expect(callback!(payload)).rejects.toThrow("binding_stale");
    expect(source.createIntake).not.toHaveBeenCalled();
  });
  it("rechecks the binding after artifacts are read and before granting a token", async () => {
    const { callback, artifacts, source, rebind } = fixture();
    artifacts.get.mockImplementationOnce(async () => {
      rebind();
      return Buffer.from("file");
    });
    await expect(callback!(payload)).rejects.toThrow("binding_stale");
    expect(source.managerServer).not.toHaveBeenCalled();
    expect(source.createIntake).not.toHaveBeenCalled();
  });
  it("rejects missing ownership and unavailable projects before staging", async () => {
    const { callback, source, prisma } = fixture();
    await expect(callback!({ ...payload, projectId: "other" })).rejects.toThrow(
      "project_unavailable",
    );
    prisma.artifact.findFirst.mockResolvedValueOnce(null as never);
    await expect(callback!(payload)).rejects.toThrow("Intake staging unavailable");
    expect(source.createIntake).not.toHaveBeenCalled();
  });
});
