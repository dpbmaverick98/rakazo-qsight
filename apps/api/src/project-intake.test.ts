import { createHash } from "node:crypto";
import { stageProjectIntake } from "@rakazo/adapters";
import { expect, it, vi } from "vitest";

const actor = {
  userId: "user",
  spaceId: "space",
  email: "a@example.test",
  isDeploymentOwner: false,
};
const input = {
  projectId: "project",
  projectName: "Project",
  botId: "bot",
  artifactIds: ["a", "b"],
};
function setup() {
  const deps = {
    readArtifact: vi.fn<Parameters<typeof stageProjectIntake>[0]["readArtifact"]>(async () => ({
      name: "file.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello 🌍").toString("base64"),
    })),
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })),
    source: {
      managerServer: vi.fn(async () => ({ token: "secret-token", tokenId: "token-id" })),
      revokeManagerToken: vi.fn(async () => {}),
      createIntake: vi.fn<Parameters<typeof stageProjectIntake>[0]["source"]["createIntake"]>(
        async () => ({
          id: "intake",
          files: [
            {
              id: "f1",
              client_id: "a",
              status: "pending",
              upload_url: "https://upload.example.test/secret",
              generation: "2",
            },
            {
              id: "f2",
              client_id: "b",
              status: "pending",
              upload_url: "https://upload.example.test/secret2",
            },
          ],
        }),
      ),
      completeIntakeFile: vi.fn<
        Parameters<typeof stageProjectIntake>[0]["source"]["completeIntakeFile"]
      >(async () => ({ status: "staged" })),
    },
  };
  return deps;
}
it("stages owned bytes with hashes, stable idempotency, per-file completion and revocation", async () => {
  const deps = setup();
  const result = await stageProjectIntake(deps, actor, input);
  expect(result).toEqual({
    intakeId: "intake",
    files: [
      { id: "f1", status: "staged" },
      { id: "f2", status: "staged" },
    ],
  });
  expect(deps.readArtifact.mock.calls).toEqual([
    [actor, { botId: "bot", artifactId: "a" }],
    [actor, { botId: "bot", artifactId: "b" }],
  ]);
  const hash = createHash("sha256").update("hello 🌍").digest("hex");
  expect(deps.source.createIntake).toHaveBeenCalledWith(
    "project",
    ["a", "b"].map((id) => ({
      source_file_id: id,
      filename: "file.txt",
      relative_path: "file.txt",
      size_bytes: Buffer.byteLength("hello 🌍"),
      content_type: "text/plain",
      expected_source_sha256: hash,
    })),
    expect.any(String),
    "secret-token",
  );
  expect(deps.fetch).toHaveBeenCalledWith(
    "https://upload.example.test/secret",
    expect.objectContaining({
      method: "PUT",
      body: Buffer.from("hello 🌍"),
      headers: { "Content-Type": "text/plain" },
      redirect: "error",
    }),
  );
  expect(deps.source.completeIntakeFile.mock.calls).toEqual([
    ["intake", "f1", { generation: 2, expected_source_sha256: hash }, "secret-token"],
    ["intake", "f2", { generation: 1, expected_source_sha256: hash }, "secret-token"],
  ]);
  expect(deps.source.revokeManagerToken).toHaveBeenCalledWith("token-id");
  await stageProjectIntake(deps, actor, input);
  expect(deps.source.createIntake.mock.calls[0]?.[2]).toBe(
    deps.source.createIntake.mock.calls[1]?.[2],
  );
  expect(JSON.stringify(result)).not.toMatch(/secret|https/);
});
for (const failure of [
  "readArtifact",
  "managerServer",
  "createIntake",
  "fetch",
  "completeIntakeFile",
] as const) {
  it(`sanitizes ${failure} failure and revokes any minted token`, async () => {
    const deps = setup();
    const mock =
      failure === "readArtifact" || failure === "fetch" ? deps[failure] : deps.source[failure];
    mock.mockRejectedValueOnce(
      new Error("https://private.example.test secret-token artifact-bytes"),
    );
    await expect(stageProjectIntake(deps, actor, input)).rejects.toThrow(
      /^Intake staging unavailable$/,
    );
    expect(deps.source.revokeManagerToken).toHaveBeenCalledTimes(
      failure === "readArtifact" || failure === "managerServer" ? 0 : 1,
    );
  });
}
it("rejects more than ten artifacts before any reads or token minting", async () => {
  const deps = setup();
  await expect(
    stageProjectIntake(deps, actor, { ...input, artifactIds: Array(11).fill("a") }),
  ).rejects.toThrow("Invalid intake request");
  expect(deps.readArtifact).not.toHaveBeenCalled();
  expect(deps.source.managerServer).not.toHaveBeenCalled();
});
it("rejects an unsuccessful PUT and revokes the token", async () => {
  const deps = setup();
  deps.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  await expect(stageProjectIntake(deps, actor, input)).rejects.toThrow(
    "Intake staging unavailable",
  );
  expect(deps.source.completeIntakeFile).not.toHaveBeenCalled();
  expect(deps.source.revokeManagerToken).toHaveBeenCalledOnce();
});
it("maps reordered identities to distinct upload bytes and completion hashes", async () => {
  const deps = setup();
  deps.readArtifact.mockImplementation(async (_actor, { artifactId }) => ({
    name: "file.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from(artifactId).toString("base64"),
  }));
  const intake = await deps.source.createIntake("project", [], "key", "token");
  deps.source.createIntake.mockResolvedValue({ ...intake, files: [...intake.files].reverse() });
  await stageProjectIntake(deps, actor, input);
  for (const [index, id] of ["b", "a"].entries()) {
    expect(deps.fetch.mock.calls[index]).toEqual([
      intake.files.find((file) => file.client_id === id)!.upload_url,
      expect.objectContaining({ body: Buffer.from(id) }),
    ]);
    expect(deps.source.completeIntakeFile.mock.calls[index]?.[2].expected_source_sha256).toBe(
      createHash("sha256").update(id).digest("hex"),
    );
  }
});
it.each([undefined, "a", "unexpected"])(
  "rejects invalid response identity %s before any PUT",
  async (client_id) => {
    const deps = setup();
    const intake = await deps.source.createIntake("project", [], "key", "token");
    intake.files[1]!.client_id = client_id;
    deps.source.createIntake.mockResolvedValue(intake);
    await expect(stageProjectIntake(deps, actor, input)).rejects.toThrow(
      /^Intake staging unavailable$/,
    );
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.source.completeIntakeFile).not.toHaveBeenCalled();
  },
);
it("replays a second-file failure, then replays all-null URLs with the same summary", async () => {
  const deps = setup();
  deps.source.completeIntakeFile.mockResolvedValue({ status: "processing" });
  deps.fetch
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(stageProjectIntake(deps, actor, input)).rejects.toThrow(
    "Intake staging unavailable",
  );
  const intake = await deps.source.createIntake("project", [], "key", "token");
  intake.files[0] = { ...intake.files[0]!, status: "processing", upload_url: null };
  deps.source.createIntake.mockResolvedValue(intake);
  deps.fetch.mockClear();
  deps.source.completeIntakeFile.mockClear();
  const summary = await stageProjectIntake(deps, actor, input);
  expect(deps.fetch).toHaveBeenCalledOnce();
  expect(deps.fetch.mock.calls[0]?.[0]).toBe(intake.files[1]!.upload_url);
  expect(deps.source.completeIntakeFile).toHaveBeenCalledOnce();
  expect(deps.source.completeIntakeFile.mock.calls[0]?.[1]).toBe("f2");
  intake.files[1] = { ...intake.files[1]!, status: "processing", upload_url: null };
  deps.fetch.mockClear();
  deps.source.completeIntakeFile.mockClear();
  expect(await stageProjectIntake(deps, actor, input)).toEqual(summary);
  expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.source.completeIntakeFile).not.toHaveBeenCalled();
});
it.each(["processing", "ready", "published", "pending", "failed"])(
  "handles null URL in %s state",
  async (status) => {
    const deps = setup();
    const intake = await deps.source.createIntake("project", [], "key", "token");
    intake.files = intake.files.map((file) => ({ ...file, status, upload_url: null }));
    deps.source.createIntake.mockResolvedValue(intake);
    const result = stageProjectIntake(deps, actor, input);
    if (["processing", "ready", "published"].includes(status))
      expect(await result).toEqual({
        intakeId: "intake",
        files: intake.files.map(({ id }) => ({ id, status })),
      });
    else await expect(result).rejects.toThrow(/^Intake staging unavailable$/);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.source.completeIntakeFile).not.toHaveBeenCalled();
  },
);
it.each(["processing", "ready", "published"])(
  "replays %s state even with a non-null upload URL",
  async (status) => {
    const deps = setup();
    const intake = await deps.source.createIntake("project", [], "key", "token");
    intake.files = intake.files.map((file) => ({ ...file, status }));
    deps.source.createIntake.mockResolvedValue(intake);
    await expect(stageProjectIntake(deps, actor, input)).resolves.toEqual({
      intakeId: "intake",
      files: intake.files.map(({ id }) => ({ id, status })),
    });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.source.completeIntakeFile).not.toHaveBeenCalled();
  },
);
it("uploads and completes failed files with non-null upload URLs", async () => {
  const deps = setup();
  const intake = await deps.source.createIntake("project", [], "key", "token");
  intake.files = intake.files.map((file) => ({ ...file, status: "failed" }));
  deps.source.createIntake.mockResolvedValue(intake);
  await expect(stageProjectIntake(deps, actor, input)).resolves.toEqual({
    intakeId: "intake",
    files: intake.files.map(({ id }) => ({ id, status: "staged" })),
  });
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  expect(deps.source.completeIntakeFile).toHaveBeenCalledTimes(2);
  for (const [index, file] of intake.files.entries()) {
    expect(deps.fetch.mock.calls[index]?.[0]).toBe(file.upload_url);
    expect(deps.source.completeIntakeFile.mock.calls[index]?.slice(0, 2)).toEqual([
      intake.id,
      file.id,
    ]);
  }
});
it("preserves success when revocation fails", async () => {
  const deps = setup();
  deps.source.revokeManagerToken.mockRejectedValue(new Error("secret-token https://private.test"));
  await expect(stageProjectIntake(deps, actor, input)).resolves.toEqual({
    intakeId: "intake",
    files: [
      { id: "f1", status: "staged" },
      { id: "f2", status: "staged" },
    ],
  });
});
it.each([
  [49, 1],
  [33, 33],
])("rejects oversized files or totals before any PUT (%s MiB, %s MiB)", async (first, second) => {
  const deps = setup();
  for (const size of [first, second])
    deps.readArtifact.mockResolvedValueOnce({
      name: "file",
      mimeType: "text/plain",
      contentBase64: Buffer.alloc(size * 1024 * 1024).toString("base64"),
    });
  await expect(stageProjectIntake(deps, actor, input)).rejects.toThrow(
    /^Intake staging unavailable$/,
  );
  expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.source.managerServer).not.toHaveBeenCalled();
});

it.each([
  "forbidden",
  "personal",
  "unbound",
  "binding_missing",
  "binding_stale",
  "project_unavailable",
  "space_unavailable",
  "disabled",
])("preserves permanent staging category %s", async (category) => {
  const deps = setup();
  const error = new Error(category);
  deps.source.managerServer.mockRejectedValueOnce(error);
  await expect(stageProjectIntake(deps, actor, input)).rejects.toBe(error);
});
