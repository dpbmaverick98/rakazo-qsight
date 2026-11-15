import type { ArtifactStageState } from "@rakazo/contracts";

/** Dev-only producer. Next: authorized agent publication of typed descriptors,
 * persisted alongside messages and refreshed through the existing live stream.
 * File storage contains bytes, not typed stage payloads; never infer one from a file body.
 */
export const artifactStageFixture: ArtifactStageState = {
  activeId: "documents",
  artifacts: [
    {
      id: "documents",
      kind: "document-list",
      schemaVersion: 1,
      title: "Project documents",
      payload: {
        documents: [
          { id: "brief", name: "Project brief", version: 2 },
          { id: "plan", name: "Delivery plan", version: 1 },
        ],
      },
    },
    {
      id: "future",
      kind: "future-summary",
      schemaVersion: 1,
      title: "Project summary",
      payload: null,
    },
  ],
};
