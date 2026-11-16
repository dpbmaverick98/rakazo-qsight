import type { CommercialInspectionSelection } from "@rakazo/contracts/project-commercial";
import { CommercialInspectionSelectionSchema } from "@rakazo/contracts/project-commercial";
import { z } from "zod";

const Selection = z.object({
  claimId: z.string(),
  vendorId: z.string().optional(),
  packageId: z.string().optional(),
  fileId: z.string().optional(),
  tab: z.enum(["space", "claims", "vendor", "file"]).optional(),
});
export type InspectionSelection = z.infer<typeof Selection>;

export function inspectionStorageKey(scope: string) {
  return `commercial-inspection:${scope}`;
}

export function restoreInspection(key: string): InspectionSelection | null {
  try {
    return Selection.parse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
  } catch {
    return null;
  }
}

/** Read the existing inspection selection at send time; never create a second context store. */
export function inspectionForSend(
  scope: string,
  projectId: string,
  bindingRevision: number,
): CommercialInspectionSelection | undefined {
  const selection = restoreInspection(inspectionStorageKey(scope));
  if (!selection || selection.tab === "space") return undefined;
  const parsed = CommercialInspectionSelectionSchema.safeParse({
    ...selection,
    projectId,
    bindingRevision,
  });
  return parsed.success ? parsed.data : undefined;
}
