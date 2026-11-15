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

it.each([
  [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0 },
  ],
  [
    { latitude: null, longitude: null },
    { latitude: null, longitude: null },
  ],
  [
    { latitude: 91, longitude: -181 },
    { latitude: null, longitude: null },
  ],
  [
    { latitude: "12", longitude: {} },
    { latitude: null, longitude: null },
  ],
  [{}, { latitude: null, longitude: null }],
])(
  "sanitizes optional upstream coordinates %j without losing navigation",
  async (coordinates, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ...raw, buildings: [{ ...raw.buildings[0], ...coordinates }] }),
      ),
    );
    const result = await qsightHierarchyFromEnv(config)!.read();
    expect(result.buildings[0]).toMatchObject({ ...expected, id: "1" });
    expect(result.buildings[0]).not.toHaveProperty("address");
  },
);
