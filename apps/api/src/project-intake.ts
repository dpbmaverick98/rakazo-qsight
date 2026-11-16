import { createHash } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type {
  CompleteIntakeFileBody,
  ProjectIntakeManifestFile,
} from "@rakazo/contracts/project-intake";

export type ProjectIntakeInput = {
  projectId: string;
  projectName: string;
  botId: string;
  artifactIds: string[];
};
export type ProjectIntakeSummary = { intakeId: string; files: { id: string; status: string }[] };
type Intake = {
  id: string;
  files: { id: string; status: string; upload_url: string | null; generation?: string }[];
};
export async function stageProjectIntake(
  deps: {
    readArtifact: (
      actor: Actor,
      input: { botId: string; artifactId: string },
    ) => Promise<{
      name: string;
      mimeType: string;
      contentBase64: string;
    }>;
    source: {
      managerServer: (id: string, name: string) => Promise<{ token: string; tokenId: string }>;
      revokeManagerToken: (id: string) => Promise<void>;
      createIntake: (
        id: string,
        files: ProjectIntakeManifestFile[],
        key: string,
        token: string,
      ) => Promise<Intake>;
      completeIntakeFile: (
        intakeId: string,
        fileId: string,
        body: CompleteIntakeFileBody,
        token: string,
      ) => Promise<{ status: string }>;
    };
    fetch?: typeof fetch;
  },
  actor: Actor,
  input: ProjectIntakeInput,
): Promise<ProjectIntakeSummary> {
  if (input.artifactIds.length > 10 || input.artifactIds.length === 0)
    throw new Error("Invalid intake request");
  try {
    const attachments = await Promise.all(
      input.artifactIds.map(async (artifactId) => {
        const artifact = await deps.readArtifact(actor, { botId: input.botId, artifactId });
        const bytes = Buffer.from(artifact.contentBase64, "base64");
        return {
          bytes,
          manifest: {
            source_file_id: artifactId,
            filename: artifact.name,
            relative_path: artifact.name,
            size_bytes: bytes.length,
            content_type: artifact.mimeType,
            expected_source_sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        };
      }),
    );
    const files = attachments.map(({ manifest }) => manifest);
    const key = createHash("sha256")
      .update(JSON.stringify([actor.spaceId, input.projectId, input.botId, files]))
      .digest("hex");
    const { token, tokenId } = await deps.source.managerServer(input.projectId, input.projectName);
    try {
      const intake = await deps.source.createIntake(input.projectId, files, key, token);
      if (intake.files.length !== attachments.length) throw new Error("Invalid intake response");
      const completed = [];
      for (const [index, file] of intake.files.entries()) {
        const attachment = attachments[index]!;
        if (!file.upload_url) throw new Error("Upload unavailable");
        const response = await (deps.fetch ?? fetch)(file.upload_url, {
          method: "PUT",
          body: attachment.bytes,
          headers: { "Content-Type": attachment.manifest.content_type },
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error("Upload unavailable");
        const result = await deps.source.completeIntakeFile(
          intake.id,
          file.id,
          {
            generation: file.generation === undefined ? 1 : Number(file.generation),
            expected_source_sha256: attachment.manifest.expected_source_sha256,
          },
          token,
        );
        completed.push({ id: file.id, status: result.status });
      }
      return { intakeId: intake.id, files: completed };
    } finally {
      await deps.source.revokeManagerToken(tokenId);
    }
  } catch {
    throw new Error("Intake staging unavailable");
  }
}
