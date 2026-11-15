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
it("requires only base and token and rejects unsafe base URLs", () => {
  expect(qsightHierarchyFromEnv({})).toBeNull();
  expect(
    qsightHierarchyFromEnv({ ...config, QSIGHT_SPACE_ID: "", QSIGHT_CLIENT_ID: "" }),
  ).not.toBeNull();
  expect(qsightHierarchyFromEnv({ ...config, QSIGHT_AGENT_TOKEN: "" })).toBeNull();
  expect(qsightHierarchyFromEnv({ ...config, QSIGHT_BASE_URL: "" })).toBeNull();
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
  expect(result.buildings[0]!.projects[0]!.url).toBe(
    "https://hierarchy.example.test/projects/roof%2Fsurvey",
  );
  await source.read();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1]).toMatchObject({
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
  expect(String(fetch.mock.calls[0]![0])).toBe(
    "https://hierarchy.example.test/api/v2/agent/projects/roof/commercial",
  );
  expect(fetch.mock.calls[0]![1]).toMatchObject({
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

it("mints a project-scoped bearer server-side and uses the configured MCP endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ token: "fake-read-only-token" }));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv({
    ...config,
    QSIGHT_MCP_ENDPOINT: "https://tools.example.test/mcp",
  })!;
  const server = await source.managerServer("roof/survey", "Roof survey");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL("https://hierarchy.example.test/api/v2/agent/projects/roof%2Fsurvey/manager-token"),
    expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer fake-token", Accept: "application/json" },
      redirect: "error",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(server).toMatchObject({
    name: "Vendor One PM — Roof survey",
    transport: "streamable_http",
    endpoint: "https://tools.example.test/mcp",
    headers: { Authorization: "Bearer fake-read-only-token" },
  });
  expect(server.slug).toMatch(/^pm-[a-f0-9]{60}$/);
});
it("caps the branded server name without changing project identity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ token: "fake-scoped" })),
  );
  const source = qsightHierarchyFromEnv(config)!;
  const short = await source.managerServer("roof", "Roof");
  const long = await source.managerServer("roof", "X".repeat(150));
  expect(long.name).toBe(`Vendor One PM — ${"X".repeat(104)}`);
  expect(long.name).toHaveLength(120);
  expect(long.slug).toBe(short.slug);
});
it("defaults to the origin's MCP endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ token: "fake-scoped" })));
  expect(await qsightHierarchyFromEnv(config)!.managerServer("roof", "Roof")).toHaveProperty(
    "endpoint",
    "https://hierarchy.example.test/mcp",
  );
});
it.each([
  () => Promise.resolve(new Response("fake-sensitive-body", { status: 403 })),
  () => Promise.resolve(Response.json({ token: "fake-sensitive\r\nvalue" })),
  () => Promise.resolve(Response.json({ access_token: "fake-sensitive" })),
  () => Promise.resolve(Response.json({ token: "x".repeat(33_000) })),
  () => Promise.reject(new Error("fake-sensitive-network-error")),
])("sanitizes minting errors and malformed credentials", async (response) => {
  vi.stubGlobal("fetch", vi.fn(response));
  await expect(qsightHierarchyFromEnv(config)!.managerServer("roof", "Roof")).rejects.toThrow(
    "Project manager credentials unavailable",
  );
});

it("selects by name without legacy IDs and isolates name and ID caches", async () => {
  const fetch = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    return Response.json({
      ...raw,
      client: { id: 7, name: url.searchParams.get("client_name") ?? raw.client.name },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await source.read("Example Client");
  await source.read("Other & Client");
  await source.read();
  await source.read("Example Client");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get("client_name")).toBe(
    "Other & Client",
  );
  expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.has("client_id")).toBe(false);
  const namedOnly = qsightHierarchyFromEnv({
    QSIGHT_BASE_URL: config.QSIGHT_BASE_URL,
    QSIGHT_AGENT_TOKEN: config.QSIGHT_AGENT_TOKEN,
  })!;
  await expect(namedOnly.read("Example Client")).resolves.toHaveProperty("client.id", "7");
  await expect(namedOnly.read()).rejects.toThrow("Hierarchy client required");
});
it("never falls back on empty, mismatched, or failed named reads and does not cache failures", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(raw));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.read("")).rejects.toThrow();
  await expect(source.read("   ")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(source.read("Other Client")).rejects.toThrow("Hierarchy client mismatch");
  await expect(source.read("Other Client")).rejects.toThrow("Hierarchy client mismatch");
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(source.read("Example Client")).rejects.toThrow();
  await expect(source.read("Example Client")).resolves.toHaveProperty(
    "client.name",
    "Example Client",
  );
  for (const [url] of fetch.mock.calls)
    expect(new URL(String(url)).searchParams.has("client_id")).toBe(false);
});

it("creates with a server token, validates the result and invalidates hierarchy cache", async () => {
  const project = {
    id: 9,
    name: "New",
    building_id: 1,
    currency: "GBP",
    url: "https://untrusted.example.test/",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(raw))
    .mockResolvedValueOnce(Response.json(project))
    .mockResolvedValueOnce(Response.json(raw));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await source.read();
  expect(await source.createProject("1", " New ")).toEqual({
    ...project,
    id: "9",
    building_id: "1",
    url: "https://hierarchy.example.test/projects/9",
  });
  expect(fetch.mock.calls[1]![0].href).toBe(
    "https://hierarchy.example.test/api/v2/agent/buildings/1/projects",
  );
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    method: "POST",
    body: '{"name":"New"}',
    headers: { Authorization: "Bearer fake-token" },
    redirect: "error",
    signal: expect.any(AbortSignal),
  });
  await source.read();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("never writes invalid input and rejects conflicts, mismatches and malformed results", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.createProject("..", "New")).rejects.toThrow();
  await expect(source.createProject("1", " ")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(new Response("private", { status: 409 }));
  await expect(source.createProject("1", "New")).rejects.toThrow("Project already exists");
  fetch.mockResolvedValueOnce(
    Response.json({
      id: "9",
      name: "New",
      building_id: "other",
      currency: "GBP",
      url: "https://example.test/",
    }),
  );
  await expect(source.createProject("1", "New")).rejects.toThrow("Project creation unavailable");
  fetch.mockResolvedValueOnce(Response.json({ token: "private" }));
  await expect(source.createProject("1", "New")).rejects.toThrow("Project creation unavailable");
});
