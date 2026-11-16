import { afterEach, expect, it, vi } from "vitest";
import { qsightHierarchyFromEnv } from "./qsight-hierarchy.js";

const token = "test-project-credential";
const view = {
  id: "i",
  project_id: "p",
  status: "staging",
  revision: 1,
  review_revision: 0,
  context_fingerprint: "fingerprint",
  currency: "USD",
  path: "",
  files: [],
  claims: [],
  subcontractors: [],
  destinations: [],
  extra: "display",
};
const files = [
  {
    source_file_id: "s",
    filename: "file.pdf",
    relative_path: "file.pdf",
    size_bytes: 0,
    content_type: "application/pdf",
  },
];
const client = () =>
  qsightHierarchyFromEnv({
    QSIGHT_BASE_URL: "https://example.test",
    QSIGHT_AGENT_TOKEN: "unused",
  })!;
afterEach(() => vi.unstubAllGlobals());

it("creates a project intake with the supplied credential and idempotency key", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view));
  vi.stubGlobal("fetch", fetch);
  await expect(client().createIntake("p", files, "key", token)).resolves.toEqual(view);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url.href).toBe("https://example.test/api/v2/agent/projects/p/intakes");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "key" },
  });
  expect(JSON.parse(init.body)).toEqual({ project_id: "p", files });
});

it("reads, completes files and saves reviews on the intake routes", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(view))
    .mockResolvedValueOnce(Response.json({ status: "complete" }))
    .mockResolvedValueOnce(Response.json(view));
  vi.stubGlobal("fetch", fetch);
  const source = client();
  await expect(source.readIntake("i/x", token)).resolves.toEqual(view);
  await expect(source.completeIntakeFile("i", "f/x", { generation: "1" }, token)).resolves.toEqual({
    status: "complete",
  });
  await expect(source.saveIntakeReview("i", { revision: 1 }, token)).resolves.toEqual(view);
  expect(fetch.mock.calls.map(([url, init]) => [url.pathname, init.method])).toEqual([
    ["/api/v2/agent/intakes/i%2Fx", "GET"],
    ["/api/v2/agent/intakes/i/files/f%2Fx/complete", "POST"],
    ["/api/v2/agent/intakes/i/review", "PATCH"],
  ]);
  for (const [, init] of fetch.mock.calls)
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ generation: "1" });
  expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({ revision: 1 });
});

it("rejects a mismatched project", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...view, project_id: "other" })),
  );
  await expect(client().createIntake("p", files, "key", token)).rejects.toThrow(
    "Intake upstream unavailable",
  );
});

it.each([
  [409, "conflict"],
  [401, "authorization"],
  [403, "authorization"],
  [500, "upstream unavailable"],
])("maps HTTP %s without exposing upstream content", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(token, { status })));
  try {
    await client().readIntake("i", token);
    expect.fail("must reject");
  } catch (error) {
    expect(String(error)).toContain(message);
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain("https:");
  }
});

it("sanitizes network and parsing errors", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error(token))
    .mockResolvedValueOnce(Response.json({ id: token }));
  vi.stubGlobal("fetch", fetch);
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(client().readIntake("i", token)).rejects.toThrow("Intake upstream unavailable");
});
