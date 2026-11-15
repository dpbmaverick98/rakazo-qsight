import { afterEach, expect, it, vi } from "vitest";
import {
  clientSetupCorrelationHeaders,
  clientSetupDebug,
  clientSetupStage,
} from "./client-setup-debug.js";
import { runWithLogContext } from "./context.js";
import { createLogger, getLogger, installLogger } from "./logger.js";
import { createTestSink } from "./test-sink.js";

const previous = getLogger();
afterEach(() => {
  vi.unstubAllEnvs();
  installLogger(previous);
});
it("emits nothing unless explicitly enabled", () => {
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  for (const value of ["", "0", "true"]) {
    vi.stubEnv("CLIENT_SETUP_DEBUG", value);
    clientSetupDebug("binding", { status: "ok" });
  }
  expect(sink.events).toEqual([]);
});
it("allows metadata only and preserves correlation without leaking errors or extra fields", async () => {
  vi.stubEnv("CLIENT_SETUP_DEBUG", "1");
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  const fields = {
    actorId: "actor",
    clientId: "client",
    token: "private-token",
    authorization: "private-auth",
    body: "private-document",
    serverName: "Bearer secret-credential",
  };
  await runWithLogContext({ "request.id": "request-1", "trace.id": "a".repeat(32) }, async () => {
    await clientSetupStage("binding", fields, async () => 42);
    await expect(
      clientSetupStage("promotion", fields, async () => {
        throw new Error("private-error-body");
      }),
    ).rejects.toThrow();
  });
  expect(sink.events).toHaveLength(2);
  expect(sink.events[0]).toMatchObject({
    message: "client_setup.binding",
    "request.id": "request-1",
    "trace.id": "a".repeat(32),
    status: "ok",
    actorId: "actor",
    clientId: "client",
  });
  expect(sink.events[1]).toMatchObject({
    status: "error",
    errorCode: "operation_failed",
    durationMs: expect.any(Number),
  });
  const serialized = JSON.stringify(sink.events);
  for (const secret of [
    "private-token",
    "private-auth",
    "private-document",
    "private-error-body",
    "secret-credential",
  ])
    expect(serialized).not.toContain(secret);
});

it("rejects unsafe correlation ids rather than forwarding header values", async () => {
  const headers = runWithLogContext(
    { "request.id": "Bearer private token" },
    clientSetupCorrelationHeaders,
  );
  expect(headers["x-request-id"]).toMatch(/^[\w.:-]{1,128}$/);
  expect(headers["x-request-id"]).not.toContain("private");
});
