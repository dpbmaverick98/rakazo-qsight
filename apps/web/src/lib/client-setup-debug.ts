import { readBoundedJsonResponse } from "@rakazo/core";
import { clientCorrelationHeaders } from "@rakazo/logging/monitoring";

type Stage = "add_client" | "finish_setup" | "add_building" | "add_project" | "location";
export function clientSetupDebugEnabled(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get("debug") === "1" ||
      window.localStorage.getItem("rakazo:client-setup-debug") === "1"
    );
  } catch {
    return false;
  }
}

/** Never inspect request bodies or print arbitrary errors/results. */
export function clientSetupDebug(stage: Stage, data: Record<string, unknown>): void {
  if (!clientSetupDebugEnabled()) return;
  const safe: Record<string, unknown> = {};
  for (const key of [
    "requestId",
    "spaceId",
    "clientId",
    "botId",
    "serverId",
    "buildingId",
    "projectId",
    "httpStatus",
    "status",
    "errorCode",
    "durationMs",
  ]) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "string") safe[key] = value.slice(0, 128);
  }
  console.debug(`client_setup.${stage}`, safe);
}

export async function clientSetupFetch(
  stage: Stage,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const correlation = clientCorrelationHeaders();
  for (const [key, value] of Object.entries(correlation)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  const started = performance.now();
  const fields = {
    requestId: headers.get("x-request-id"),
    spaceId: headers.get("x-rakazo-space-id"),
  };
  clientSetupDebug(stage, { ...fields, status: "started" });
  try {
    const response = await fetch(input, { ...init, headers });
    let errorCode = response.ok ? undefined : `http_${response.status}`;
    if (!response.ok && clientSetupDebugEnabled()) {
      try {
        const body: unknown = await readBoundedJsonResponse(
          response.clone(),
          4096,
          AbortSignal.timeout(1000),
        );
        const code = body && typeof body === "object" && "status" in body ? body.status : undefined;
        const known = [
          "unauthorized",
          "forbidden",
          "invalid_request",
          "disabled",
          "client_conflict",
          "binding_conflict",
          "binding_stale",
          "binding_mismatch",
          "setup_finished",
          "setup_unavailable",
          "upstream_unavailable",
        ];
        if (typeof code === "string" && known.includes(code)) errorCode = code;
      } catch {
        // An unreadable diagnostic response retains the HTTP code; the caller owns its body.
      }
    }
    clientSetupDebug(stage, {
      ...fields,
      requestId: response.headers.get("x-request-id") ?? fields.requestId,
      httpStatus: response.status,
      status: response.ok ? "ok" : "error",
      errorCode,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    clientSetupDebug(stage, {
      ...fields,
      status: "error",
      errorCode: "transport_failed",
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}
