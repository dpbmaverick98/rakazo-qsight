import { t } from "@lingui/core/macro";
import type { ClientSetup } from "@rakazo/contracts/hierarchy";
import { ClientNavigationSchema, ClientSetupSchema } from "@rakazo/contracts/hierarchy";
import { captureApiRequestContext, currentApiBase, fetchMobileJson } from "./api";
import { spaceHttpQuery } from "./query";
import { currentSessionGeneration } from "./session";

export async function setupClient(name: string, spaceId?: string): Promise<ClientSetup> {
  const context = await captureApiRequestContext(spaceId);
  const { response, body } = await fetchMobileJson<unknown>(
    `${context.apiBase}/api/agent-plane/clients`,
    {
      method: "POST",
      headers: { ...context.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    },
    undefined,
    context.apiBase,
  );
  if (
    context.apiBase !== currentApiBase() ||
    context.sessionGeneration !== currentSessionGeneration()
  )
    throw new Error(t`Something went wrong. Try again.`);
  if (response.status === 409) {
    const archived =
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "setup_archived";
    throw new Error(
      archived
        ? t`Restore the PM from Archived chats to continue setup.`
        : t`Client setup conflicts with an existing binding.`,
    );
  }
  if (!response.ok) throw new Error(t`Could not finish client setup. Try again.`);
  return ClientSetupSchema.parse(body);
}

export function clientNavigationQuery(spaceId: string) {
  return spaceHttpQuery(
    "client-navigation",
    async (context, signal) => {
      const { response, body } = await fetchMobileJson<unknown>(
        `${context.apiBase}/api/agent-plane/navigation`,
        { headers: context.headers, signal },
        undefined,
        context.apiBase,
      );
      if (!response.ok) throw new Error(t`Client setup unavailable`);
      const navigation = ClientNavigationSchema.parse(body);
      if (navigation.spaceId !== spaceId) throw new Error(t`Client setup unavailable`);
      return navigation;
    },
    spaceId,
  );
}
