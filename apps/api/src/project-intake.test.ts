import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { stageProjectIntake } from "./project-intake.js";

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
              status: "pending",
              upload_url: "https://upload.example.test/secret",
              generation: "2",
            },
            { id: "f2", status: "pending", upload_url: "https://upload.example.test/secret2" },
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
  "revokeManagerToken",
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
