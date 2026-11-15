import { getLogContext } from "./context.js";
import { outgoingCorrelationHeaders } from "./correlation.js";
import { isValidRequestId } from "./ids.js";
import { getLogger } from "./logger.js";

export type SetupStage =
  | "setup"
  | "client.lookup"
  | "client.create"
  | "client.reuse"
  | "space.resolve"
  | "binding"
  | "setup_pm"
  | "mcp.attach"
  | "promotion"
  | "token.revoke"
  | "upstream"
  | "mcp.selected";
export type SetupFields = {
  actorId?: string;
  spaceId?: string;
  clientId?: string;
  botId?: string;
  serverId?: string;
  serverName?: string;
  operation?: string;
  toolName?: string;
  status?: string;
  httpStatus?: number;
  durationMs?: number;
  errorCode?: string;
  requestId?: string;
};
const fields = [
  "actorId",
  "spaceId",
  "clientId",
  "botId",
  "serverId",
  "serverName",
  "operation",
  "toolName",
  "status",
  "httpStatus",
  "durationMs",
  "errorCode",
  "requestId",
] as const;

/** Opt-in metadata only. Never pass an error object, credential, URL or request/response body. */
export function clientSetupDebug(stage: SetupStage, data: SetupFields): void {
  if (process.env.CLIENT_SETUP_DEBUG !== "1") return;
  const safe: Record<string, string | number> = { durationMs: 0 };
  for (const key of fields) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "string") safe[key] = value.slice(0, 128);
  }
  // An explicit toggle works with the normal info threshold; off emits nothing.
  getLogger().info(`client_setup.${stage}`, safe);
}

export async function clientSetupStage<T>(
  stage: SetupStage,
  fields: SetupFields,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const context: Record<string, string> = {};
    for (const key of ["actorId", "spaceId", "clientId", "botId", "serverId"] as const) {
      const value = fields[key];
      if (value !== undefined) context[key] = value.slice(0, 128);
    }
    const result = await getLogger().withContext(context, work);
    clientSetupDebug(stage, {
      ...fields,
      status: fields.status ?? "ok",
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const known = [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "BAD_GATEWAY",
      "SERVICE_UNAVAILABLE",
      "INTERNAL_SERVER_ERROR",
    ];
    clientSetupDebug(stage, {
      ...fields,
      status: "error",
      durationMs: Math.round(performance.now() - started),
      errorCode: typeof code === "string" && known.includes(code) ? code : "operation_failed",
    });
    throw error;
  }
}

/** Preserve the request id only after validation; traceparent gets a fresh child span. */
export function clientSetupCorrelationHeaders(): Record<string, string> {
  const headers = outgoingCorrelationHeaders();
  const requestId = getLogContext()["request.id"];
  if (typeof requestId === "string" && isValidRequestId(requestId))
    headers["x-request-id"] = requestId;
  return headers;
}
