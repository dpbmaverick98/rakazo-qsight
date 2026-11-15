import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import {
  createLogger,
  createTestSink,
  getLogger,
  installLogger,
  runWithLogContext,
} from "@rakazo/logging";
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
const client = { id: "7", name: "Example Client", url: "https://hierarchy.example.test/clients/7" };
it("creates clients with the server token and recovers 409 using an exact-name lookup", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ ...client, id: 7 }, { status: 201 }))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(
      Response.json({ items: [{ ...client, id: "8", name: "Example Client other" }, client] }),
    );
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.createClient(" Example Client ")).resolves.toEqual(client);
  expect(fetch.mock.calls[0]).toEqual([
    new URL("https://hierarchy.example.test/api/v2/agent/clients"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: client.name }),
      redirect: "error",
      headers: expect.objectContaining({ Authorization: "Bearer fake-token" }),
      signal: expect.any(AbortSignal),
    }),
  ]);
  await expect(source.createClient(client.name)).resolves.toBeNull();
  await expect(source.findClient(client.name)).resolves.toEqual(client);
  const [url, request] = fetch.mock.calls[2]!;
  expect(new URL(String(url)).searchParams.get("name")).toBe(client.name);
  expect(request).toMatchObject({
    headers: { Authorization: "Bearer fake-token" },
    redirect: "error",
  });
});
it("does not adopt a different or ambiguous client and sanitizes upstream errors", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ items: [{ ...client, name: "example client" }] }))
    .mockResolvedValueOnce(Response.json({ items: [client, { ...client, id: "8" }] }))
    .mockResolvedValueOnce(Response.json({ ...client, name: "Other" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json(client))
    .mockRejectedValueOnce(new Error("fake-secret-value"));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.findClient(client.name)).resolves.toBeNull();
  await expect(source.findClient(client.name)).rejects.toThrow("Client lookup unavailable");
  await expect(source.createClient(client.name)).rejects.toThrow("Client creation unavailable");
  await expect(source.createClient(client.name)).rejects.toThrow("Client creation unavailable");
  await expect(source.createClient(client.name)).rejects.toThrow("Client creation unavailable");
});
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
  const result = await source.read("7");
  expect(result.client).toEqual({ id: "7", name: "Example Client" });
  expect(result.buildings[0]).not.toHaveProperty("address");
  expect(result.buildings[0]!.projects[0]!.url).toBe(
    "https://hierarchy.example.test/projects/roof%2Fsurvey",
  );
  await source.read("7");
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
  for (let i = 0; i < 3; i++) await expect(source.read("7")).rejects.toThrow();
  await expect(source.read("7")).resolves.toHaveProperty("client.id", "7");
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
    const result = await qsightHierarchyFromEnv(config)!.read("7");
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
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      project_id: "roof/survey",
      token_id: "test-token-id",
      token: "fake-read-only-token",
    }),
  );
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
      headers: expect.objectContaining({
        Authorization: "Bearer fake-token",
        Accept: "application/json",
      }),
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
    vi.fn(async () =>
      Response.json({ project_id: "roof", token_id: "test-token-id", token: "fake-scoped" }),
    ),
  );
  const source = qsightHierarchyFromEnv(config)!;
  const short = await source.managerServer("roof", "Roof");
  const long = await source.managerServer("roof", "X".repeat(150));
  expect(long.name).toBe(`Vendor One PM — ${"X".repeat(104)}`);
  expect(long.name).toHaveLength(120);
  expect(long.slug).toBe(short.slug);
});
it("defaults to the origin's MCP endpoint", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ project_id: "roof", token_id: "test-token-id", token: "fake-scoped" }),
      ),
  );
  expect(await qsightHierarchyFromEnv(config)!.managerServer("roof", "Roof")).toHaveProperty(
    "endpoint",
    "https://hierarchy.example.test/mcp",
  );
});
it.each([
  () => Promise.resolve(new Response("fake-sensitive-body", { status: 403 })),
  () =>
    Promise.resolve(
      Response.json({
        project_id: "roof",
        token_id: "test-token-id",
        token: "fake-sensitive\r\nvalue",
      }),
    ),
  () => Promise.resolve(Response.json({ access_token: "fake-sensitive" })),
  () => Promise.resolve(Response.json({ token: "x".repeat(33_000) })),
  () => Promise.reject(new Error("fake-sensitive-network-error")),
])("sanitizes minting errors and malformed credentials", async (response) => {
  vi.stubGlobal("fetch", vi.fn(response));
  await expect(qsightHierarchyFromEnv(config)!.managerServer("roof", "Roof")).rejects.toThrow(
    "Project manager credentials unavailable",
  );
});

it("reads only canonical IDs, validates returned identity and never falls back to names", async () => {
  const fetch = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    return Response.json({
      ...raw,
      client: { id: url.searchParams.get("client_id"), name: "Same name" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await source.read("7");
  await source.read("8");
  await source.read("7");
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url] of fetch.mock.calls)
    expect(new URL(String(url)).searchParams.has("client_name")).toBe(false);
  await expect(source.read("")).rejects.toThrow();
  await expect(source.read("   ")).rejects.toThrow();
  fetch.mockImplementation(async () => Response.json(raw));
  await expect(source.read("other")).rejects.toThrow("Hierarchy client mismatch");
  await expect(source.read("other")).rejects.toThrow("Hierarchy client mismatch");
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
  await source.read("7");
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
  await source.read("7");
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

it("reuses project receipt keys after a lost response and rejects the wrong returned parent", async () => {
  const project = {
    id: "p",
    name: "Roof",
    building_id: "b",
    currency: "USD",
    url: "https://hierarchy.example.test/projects/p",
  };
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce(Response.json(project))
    .mockResolvedValueOnce(Response.json({ ...project, building_id: "other" }));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.createProject("b", "Roof")).rejects.toThrow();
  await expect(source.createProject("b", " Roof ")).resolves.toMatchObject({ id: "p" });
  expect(fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toMatch(/^[a-f0-9]{64}$/);
  expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(
    fetch.mock.calls[0]![1].headers["Idempotency-Key"],
  );
  await expect(source.createProject("b", "Roof")).rejects.toThrow("Project creation unavailable");
});
it("searches, proves the selected candidate, and replays the exact confirmed building payload", async () => {
  const candidate = {
    address: "10 Example Street",
    latitude: 1,
    longitude: 2,
    attribution: "Example attribution",
    selectable: true,
    verification_token: "fake-candidate",
  };
  const proof = {
    ...candidate,
    verification_token: "fake-proof",
    location_precision: "building",
    expires_in: 1800,
  };
  const building = {
    id: 8,
    client_id: "7",
    name: "Site",
    address: candidate.address,
    url: "https://untrusted.example.test",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ items: [candidate], attribution: candidate.attribution }),
    )
    .mockResolvedValueOnce(Response.json(proof))
    .mockRejectedValueOnce(new Error("lost response"))
    .mockImplementation(async () => Response.json(building, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  expect(await source.searchLocations(" Example Street ")).toHaveProperty(
    "items.0.selectable",
    true,
  );
  expect(await source.proveLocation(candidate.verification_token)).toHaveProperty(
    "verification_token",
    "fake-proof",
  );
  const input = {
    address: proof.address,
    verification_token: proof.verification_token,
    nickname: "Site",
  };
  await expect(source.createBuilding("7", input)).rejects.toThrow();
  expect(await source.createBuilding("7", input)).toHaveProperty(
    "url",
    "https://hierarchy.example.test/buildings/8",
  );
  expect(fetch.mock.calls[2]![1].headers["Idempotency-Key"]).toBe(
    fetch.mock.calls[3]![1].headers["Idempotency-Key"],
  );
  expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({ client_id: "7", ...input });
  await expect(source.createBuilding("other", input)).rejects.toThrow("Building creation mismatch");
  expect(fetch.mock.calls[4]![1].headers["Idempotency-Key"]).not.toBe(
    fetch.mock.calls[3]![1].headers["Idempotency-Key"],
  );
});
it("revokes tokens with owner authorization and sanitizes malformed scoped credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ token_id: "minted", project_id: "wrong", token: "fake-bearer" }),
    )
    .mockResolvedValue(Response.json({ revoked: true }));
  vi.stubGlobal("fetch", fetch);
  const source = qsightHierarchyFromEnv(config)!;
  await expect(source.managerServer("roof", "Roof")).rejects.toThrow(
    "Project manager credentials unavailable",
  );
  expect(fetch.mock.calls[1]).toEqual([
    new URL("https://hierarchy.example.test/api/v2/agent/tokens/minted"),
    expect.objectContaining({
      method: "DELETE",
      headers: expect.objectContaining({
        Authorization: "Bearer fake-token",
        Accept: "application/json",
      }),
    }),
  ]);
});

it("forwards safe request correlation and emits only opt-in upstream metadata", async () => {
  const previous = getLogger();
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  const fetch = vi.fn().mockImplementation(async () => Response.json({ items: [client] }));
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("CLIENT_SETUP_DEBUG", "1");
  try {
    await runWithLogContext({ "request.id": "setup-request", "trace.id": "a".repeat(32) }, () =>
      qsightHierarchyFromEnv(config)!.findClient(client.name),
    );
    const headers = new Headers(fetch.mock.calls[0]![1].headers);
    expect(headers.get("x-request-id")).toBe("setup-request");
    expect(headers.get("traceparent")).toContain("a".repeat(32));
    expect(sink.events[0]).toMatchObject({
      message: "client_setup.upstream",
      operation: "client.lookup",
      requestId: "setup-request",
      httpStatus: 200,
    });
    expect(JSON.stringify(sink.events)).not.toContain(config.QSIGHT_AGENT_TOKEN);
    expect(JSON.stringify(sink.events)).not.toContain(client.name);
    sink.events.length = 0;
    vi.stubEnv("CLIENT_SETUP_DEBUG", "0");
    await qsightHierarchyFromEnv(config)!.findClient(client.name);
    expect(sink.events).toEqual([]);
  } finally {
    installLogger(previous);
    vi.unstubAllEnvs();
  }
});
