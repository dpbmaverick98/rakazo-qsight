import { describe, expect, it } from "vitest";
import {
  ArtifactStageStateSchema,
  StageArtifactSchema,
  selectArtifactRenderer,
} from "./artifact-stage.js";

const artifact = {
  id: "docs",
  kind: "document-list",
  schemaVersion: 1,
  title: "Documents",
  payload: { documents: [{ id: "plan", name: "Plan", version: 1 }] },
};
describe("artifact stage contract", () => {
  it("validates metadata and rejects document bodies or executable fields", () => {
    expect(StageArtifactSchema.safeParse(artifact).success).toBe(true);
    for (const field of ["html", "script", "url", "secret", "text"]) {
      expect(
        StageArtifactSchema.safeParse({
          ...artifact,
          payload: { ...artifact.payload, [field]: "untrusted" },
        }).success,
      ).toBe(false);
    }
    expect(StageArtifactSchema.safeParse({ ...artifact, schemaVersion: 0 }).success).toBe(false);
    expect(
      StageArtifactSchema.safeParse({
        ...artifact,
        payload: { documents: [{ id: "a", name: "a", version: -1 }] },
      }).success,
    ).toBe(false);
  });
  it("requires unique history IDs and a valid active selection", () => {
    expect(
      ArtifactStageStateSchema.safeParse({ activeId: "docs", artifacts: [artifact] }).success,
    ).toBe(true);
    expect(
      ArtifactStageStateSchema.safeParse({ activeId: "missing", artifacts: [artifact] }).success,
    ).toBe(false);
    expect(
      ArtifactStageStateSchema.safeParse({ activeId: "docs", artifacts: [artifact, artifact] })
        .success,
    ).toBe(false);
    expect(ArtifactStageStateSchema.safeParse({ activeId: null, artifacts: [] }).success).toBe(
      true,
    );
  });
  it("selects by both kind and version, including hostile object property names", () => {
    const registry = new Map([["document-list:1", "documents"]]);
    expect(selectArtifactRenderer(registry, artifact)).toBe("documents");
    for (const unknown of [
      { kind: "future", schemaVersion: 1 },
      { kind: "document-list", schemaVersion: 2 },
      { kind: "constructor", schemaVersion: 1 },
    ]) {
      expect(selectArtifactRenderer(registry, { ...artifact, ...unknown })).toBeUndefined();
      expect(StageArtifactSchema.safeParse({ ...artifact, ...unknown }).success).toBe(true);
    }
  });
});
