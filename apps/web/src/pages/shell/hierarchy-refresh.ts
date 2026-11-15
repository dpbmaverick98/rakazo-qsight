import type { ProductEvent } from "@rakazo/contracts";
import { isRunTerminalEvent } from "@rakazo/core";
import type { QueryClient } from "@tanstack/react-query";

/** Retry temporary session/proxy failures, never permission denials or invalid data. */
export function hierarchyRetry(failures: number, error: Error) {
  return failures < 3 && "status" in error && [401, 502, 503, 504].includes(Number(error.status));
}

/** Tool names belong to adapters. Reconcile after any completed tool, including external writes. */
export function hierarchyChangedBy(event: Pick<ProductEvent, "type">) {
  return (
    event.type === "agent.tool.completed" ||
    isRunTerminalEvent(event) ||
    event.type === "run.waiting_input"
  );
}

export async function refreshHierarchy(
  client: QueryClient,
  userId: string | null,
  spaceId?: string | null,
) {
  const scope = spaceId === undefined ? [userId] : [userId, spaceId];
  await Promise.all(
    ["hierarchy", "project-commercial", "client-navigation"].map((key) =>
      client.invalidateQueries({ queryKey: [key, ...scope] }),
    ),
  );
}
