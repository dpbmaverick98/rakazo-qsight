import { beforeEach, expect, it, vi } from "vitest";
import { clientNavigationQuery, setupClient } from "./client-setup";
import { queryClient } from "./query";

const state = vi.hoisted(() => ({ generation: 1, fetch: vi.fn() }));
vi.mock("./api", () => ({
  currentApiBase: () => "https://api.example.test",
  selectedSpaceId: () => "source-space",
  captureApiRequestContext: async (spaceId = "source-space") => ({
    apiBase: "https://api.example.test",
    sessionGeneration: state.generation,
    headers: { authorization: "Bearer fake-token", "x-rakazo-space-id": spaceId },
  }),
  fetchMobileJson: state.fetch,
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => state.generation }));
const setup = {
  clientId: "client",
  spaceId: "target-space",
  botId: "pm",
  serverId: null,
  status: "mcp_missing",
};
const navigation = {
  spaceId: "target-space",
  bindingRevision: 1,
  client: { id: "client", name: "Example" },
  setupBotIds: ["pm"],
  buildings: [],
};
beforeEach(() => {
  state.generation = 1;
  state.fetch.mockReset();
  queryClient.clear();
});
it("uses the one-field setup API with captured authentication and target Space", async () => {
  state.fetch.mockResolvedValue({ response: { ok: true }, body: setup });
  expect(await setupClient("  Example  ", "target-space")).toEqual(setup);
  expect(state.fetch).toHaveBeenCalledWith(
    "https://api.example.test/api/agent-plane/clients",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Example" }),
      headers: expect.objectContaining({
        authorization: "Bearer fake-token",
        "x-rakazo-space-id": "target-space",
      }),
    }),
    undefined,
    "https://api.example.test",
  );
});
it("directs archived setup recovery to explicit restore", async () => {
  state.fetch.mockResolvedValue({
    response: { ok: false, status: 409 },
    body: { status: "setup_archived" },
  });
  await expect(setupClient("Example")).rejects.toThrow("Restore the PM from Archived chats");
});
it("discards a setup response after the session changes", async () => {
  state.fetch.mockImplementation(async () => {
    state.generation++;
    return { response: { ok: true }, body: setup };
  });
  await expect(setupClient("Example")).rejects.toThrow("Try again");
});
it("reads canonical navigation and rejects a different target Space", async () => {
  state.fetch.mockResolvedValue({ response: { ok: true }, body: navigation });
  expect(await queryClient.fetchQuery(clientNavigationQuery("target-space"))).toEqual(navigation);
  state.fetch.mockResolvedValue({
    response: { ok: true },
    body: { ...navigation, spaceId: "another-space" },
  });
  queryClient.clear();
  await expect(queryClient.fetchQuery(clientNavigationQuery("target-space"))).rejects.toThrow(
    "Client setup unavailable",
  );
});
it("never caches a read under a changed session", async () => {
  state.fetch.mockImplementation(async () => {
    state.generation++;
    return { response: { ok: true }, body: navigation };
  });
  await expect(queryClient.fetchQuery(clientNavigationQuery("target-space"))).rejects.toThrow(
    "Try again",
  );
});
