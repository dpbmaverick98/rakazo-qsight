import { z } from "zod";

// Stage payloads are metadata, never file bodies or executable content.
const Label = z.string().trim().min(1).max(160);
export const DocumentListPayloadSchema = z.strictObject({
  documents: z
    .array(z.strictObject({ id: Label, name: Label, version: z.number().int().positive() }))
    .max(50),
});

/** Unknown kind/version pairs may travel through the stage, but are never rendered. */
export const StageArtifactSchema = z
  .strictObject({
    id: Label,
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    schemaVersion: z.number().int().positive(),
    title: Label,
    subtitle: Label.optional(),
    payload: z.json(),
  })
  .superRefine((artifact, context) => {
    if (artifact.kind === "document-list" && artifact.schemaVersion === 1) {
      const result = DocumentListPayloadSchema.safeParse(artifact.payload);
      if (!result.success) {
        for (const issue of result.error.issues)
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
      }
    }
  });
export type StageArtifact = z.infer<typeof StageArtifactSchema>;

export const ArtifactStageStateSchema = z
  .strictObject({
    activeId: Label.nullable(),
    artifacts: z.array(StageArtifactSchema).max(20),
  })
  .superRefine((state, context) => {
    const ids = new Set(state.artifacts.map((artifact) => artifact.id));
    if (
      ids.size !== state.artifacts.length ||
      (state.activeId !== null && !ids.has(state.activeId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Stage requires unique IDs and an existing active artifact",
      });
    }
  });
export type ArtifactStageState = z.infer<typeof ArtifactStageStateSchema>;

/** Platform renderers share a kind/version key; functions stay in their frontend. */
export type ArtifactRendererRegistry<T> = ReadonlyMap<string, T>;
export function artifactRendererKey(kind: string, schemaVersion: number): string {
  return `${kind}:${schemaVersion}`;
}
export function selectArtifactRenderer<T>(
  registry: ArtifactRendererRegistry<T>,
  artifact: StageArtifact,
): T | undefined {
  return registry.get(artifactRendererKey(artifact.kind, artifact.schemaVersion));
}
