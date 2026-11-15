import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { afterEach, expect, it, vi } from "vitest";
import { qsightHierarchyFromEnv } from "./qsight-hierarchy.js";

const config = {
  QSIGHT_BASE_URL: "https://hierarchy.example.test",
  QSIGHT_AGENT_TOKEN: "fake-token",
  QSIGHT_CLIENT_ID: "7",
  QSIGHT_SPACE_ID: "client-space",
};
const raw = {
  client: { id: 7, name: "Example Client", secret: "omit" },
  buildings: [
    {
      id: 1,
      name: "North Building",
      nickname: "North",
      address: "Example address",
      projects: [{ id: "roof/survey", name: "Roof survey" }],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("stays disabled without all settings and rejects unsafe base URLs", () => {
  expect(qsightHierarchyFromEnv({})).toBeNull();
  expect(qsightHierarchyFromEnv({ ...config, QSIGHT_SPACE_ID: "" })).toBeNull();
  expect(() => qsightHierarchyFromEnv({ ...config, QSIGHT_BASE_URL: "file:///tmp" })).toThrow();
  expect(() =>
    qsightHierarchyFromEnv({ ...config, QSIGHT_BASE_URL: "http://example.test" }),
  ).toThrow();
  expect(
    qsightHierarchyFromEnv({ ...config, QSIGHT_BASE_URL: "http://127.0.0.1:8002" }),
  ).not.toBeNull();
});
it("authenticates server-side, sanitizes data, encodes links and caches briefly", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(raw));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  const result = await source.read();
  expect(result.client).toEqual({ id: "7", name: "Example Client" });
  expect(result.buildings[0]).not.toHaveProperty("address");
  expect(result.buildings[0].projects[0].url).toBe(
    "https://hierarchy.example.test/projects/roof%2Fsurvey",
  );
  await source.read();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    headers: { Authorization: "Bearer fake-token" },
    redirect: "error",
  });
});
it("does not cache errors, malformed data, or another client", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("private", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ...raw, client: { id: 8, name: "Other" } }))
    .mockResolvedValueOnce(Response.json({ buildings: [] }))
    .mockResolvedValueOnce(Response.json(raw));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  for (let i = 0; i < 3; i++) await expect(source.read()).rejects.toThrow();
  await expect(source.read()).resolves.toHaveProperty("client.id", "7");
});

it("reads bounded commercial projections with bearer auth, canonical links and a short cache", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ ...commercialFixture, secret: "omit" }),
  );
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  const result = await source.readCommercial("roof");
  expect(result).toEqual(commercialFixture);
  await source.readCommercial("roof");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toBe(
    "https://hierarchy.example.test/api/v2/agent/projects/roof/commercial",
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { Authorization: "Bearer fake-token" },
    signal: expect.any(AbortSignal),
  });
});
it("rejects upstream errors, wrong project, malformed and oversized commercial data without caching", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("private", { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({
        ...commercialFixture,
        project: { ...commercialFixture.project, id: "other" },
      }),
    )
    .mockResolvedValueOnce(Response.json({ project: {} }))
    .mockResolvedValueOnce(Response.json({ padding: "x".repeat(256_001) }))
    .mockRejectedValueOnce(new DOMException("Deadline", "TimeoutError"))
    .mockResolvedValueOnce(Response.json(commercialFixture));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  for (let i = 0; i < 5; i++) await expect(source.readCommercial("roof")).rejects.toThrow();
  await expect(source.readCommercial("roof")).resolves.toEqual(commercialFixture);
});
