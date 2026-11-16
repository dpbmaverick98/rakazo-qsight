import { z } from "zod";

const Id = z.string().min(1);
const Status = z.string().min(1);
const Sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/);
const DisplayName = z
  .string()
  .nullish()
  .transform((value) => value || "Address missing");

export const ProjectIntakeManifestFileSchema = z.object({
  source_file_id: Id,
  filename: DisplayName,
  relative_path: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string(),
  expected_source_sha256: Sha256.optional(),
});

export const ProjectIntakeFileSchema = z
  .object({
    id: Id,
    filename: DisplayName,
    status: Status,
    upload_url: z.string().nullable(),
    source_url: z.string(),
    size_bytes: z.number().int().nonnegative(),
    content_type: z.string(),
    generation: z.string().optional(),
    expected_source_sha256: Sha256.optional(),
  })
  .passthrough();

const NamedRecord = z.object({ id: Id, name: DisplayName }).passthrough();
export const ProjectIntakeViewSchema = z
  .object({
    id: Id,
    project_id: Id,
    status: Status,
    revision: z.number().int().nonnegative(),
    review_revision: z.number().int().nonnegative(),
    context_fingerprint: z.string(),
    currency: z.string(),
    path: z.string(),
    files: z.array(ProjectIntakeFileSchema),
    claims: z.array(NamedRecord),
    subcontractors: z.array(NamedRecord),
    destinations: z.array(NamedRecord),
  })
  .passthrough();

export const CompletionResponseSchema = z.object({ status: Status });
export type ProjectIntakeManifestFile = z.infer<typeof ProjectIntakeManifestFileSchema>;
export type ProjectIntakeFile = z.infer<typeof ProjectIntakeFileSchema>;
export type ProjectIntakeView = z.infer<typeof ProjectIntakeViewSchema>;
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
export type CompleteIntakeFileBody = {
  generation?: string;
  reconfirm_source?: boolean;
  expected_source_sha256?: string;
};
export type IntakeReviewBody = Record<string, unknown>;
