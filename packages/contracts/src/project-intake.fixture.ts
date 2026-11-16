import type { z } from "zod";
import type {
  CompleteIntakeFileBodySchema,
  CompletionResponseSchema,
  ProjectIntakeManifestFilesSchema,
  ProjectIntakeViewSchema,
} from "./project-intake.js";

/**
 * Synthetic vendor-one-agentic contracts/agent-intake/fixtures.json, v1.0.0.
 * Refresh from the producer fixture whenever that contract version changes;
 * keep this vendored copy identical in data for offline consumer conformance.
 */
export const projectIntakeFixture = {
  request: {
    project_id: "project-fixture",
    files: [
      {
        source_file_id: "local-file-1",
        filename: "synthetic.pdf",
        relative_path: "folder/synthetic.pdf",
        size_bytes: 128,
        content_type: "application/pdf",
      },
    ],
  },
  response: {
    id: "intake-fixture",
    project_id: "project-fixture",
    status: "open",
    revision: 1,
    review_revision: 0,
    context_fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    currency: "USD",
    path: {
      client: null,
      building: null,
      project: {
        id: "project-fixture",
        name: "Synthetic Project",
      },
    },
    files: [
      {
        id: "file-fixture",
        client_id: "local-file-1",
        filename: "synthetic.pdf",
        status: "uploading",
        size_bytes: 128,
        content_type: "application/pdf",
        upload_url: "https://example.invalid/synthetic-upload",
        source_url: "https://example.invalid/synthetic-source",
      },
    ],
    claims: [
      {
        id: "claim-fixture",
        name: "Synthetic Claim",
      },
    ],
    subcontractors: [
      {
        id: "vendor-fixture",
        claim_id: "claim-fixture",
        name: "Synthetic Vendor",
      },
    ],
    destinations: [
      {
        id: "package-fixture",
        claim_id: "claim-fixture",
        subcontractor_id: "vendor-fixture",
        name: "Synthetic Package",
      },
    ],
  },
  complete_request: {
    generation: 1,
    reconfirm_source: true,
    expected_source_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  complete_response: {
    status: "processing",
  },
} satisfies {
  request: { project_id: string; files: z.input<typeof ProjectIntakeManifestFilesSchema> };
  response: z.input<typeof ProjectIntakeViewSchema>;
  complete_request: z.input<typeof CompleteIntakeFileBodySchema>;
  complete_response: z.input<typeof CompletionResponseSchema>;
};
