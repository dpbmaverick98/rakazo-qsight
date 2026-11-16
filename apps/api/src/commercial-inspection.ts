import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { CommercialInspectionSelection } from "@rakazo/contracts/project-commercial";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import type { Prisma } from "@rakazo/db";
import { commercialInspectionPrompt } from "./commercial-inspection.prompt.js";
import type { RouterDeps } from "./router.js";
import { boundHierarchy, resolveClientBinding } from "./space-client-binding.js";
import type { ThreadTarget } from "./thread-target.js";

export type ResolvedInspection = {
  projectId: string;
  bindingRevision: number;
  prompt: string;
};

function unavailable(): never {
  throw new ORPCError("BAD_REQUEST", { message: "Inspection selection unavailable" });
}

function unique<T>(items: T[], matches: (item: T) => boolean): T {
  const found = items.filter(matches);
  if (found.length !== 1) return unavailable();
  return found[0]!;
}

/** Fresh existing projections are the authority; incomplete projections fail closed. */
export async function resolveCommercialInspection(
  deps: Pick<RouterDeps, "prisma" | "projectManagers">,
  actor: Actor,
  target: ThreadTarget,
  selection: CommercialInspectionSelection,
): Promise<ResolvedInspection> {
  if (target.kind !== "bot" || !target.bot.spawnKey?.startsWith("pm:")) return unavailable();
  const projectId = target.bot.spawnKey.slice(3);
  if (selection.projectId !== projectId) return unavailable();
  if ((!selection.vendorId && selection.packageId) || (!selection.packageId && selection.fileId))
    return unavailable();
  const source = deps.projectManagers;
  if (!source?.readCommercial) throw new ORPCError("SERVICE_UNAVAILABLE");
  const { hierarchy, binding } = await boundHierarchy(
    deps.prisma,
    actor,
    source,
    selection.bindingRevision,
  );
  const project = unique(
    hierarchy.buildings.flatMap((building) => building.projects),
    (item) => item.id === projectId,
  );
  const commercial = ProjectCommercialSchema.parse(await source.readCommercial(projectId, true));
  if (commercial.project.id !== projectId) return unavailable();
  const claim = unique(commercial.claims, (item) => item.id === selection.claimId);
  const vendor = selection.vendorId
    ? unique(claim.sub_vendors, (item) => item.id === selection.vendorId)
    : undefined;
  const workPackage = selection.packageId
    ? unique(vendor!.work_packages, (item) => item.id === selection.packageId)
    : undefined;
  const document = selection.fileId
    ? unique(workPackage!.documents ?? [], (item) => item.id === selection.fileId)
    : undefined;
  await resolveClientBinding(deps.prisma, actor, binding.revision);
  return {
    projectId,
    bindingRevision: binding.revision,
    prompt: commercialInspectionPrompt({
      bindingRevision: binding.revision,
      project: { id: project.id, name: project.name },
      claim: { id: claim.id, name: claim.name },
      vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
      workPackage: workPackage ? { id: workPackage.id, name: workPackage.title } : null,
      document: document ? { id: document.id, name: document.filename } : null,
    }),
  };
}

/** Serialize admission with binding changes; no external requests under the lock. */
export async function assertInspectionCurrent(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: ThreadTarget,
  inspection: ResolvedInspection,
) {
  await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${actor.spaceId} FOR SHARE`;
  await resolveClientBinding(tx, actor, inspection.bindingRevision);
  if (target.kind !== "bot") return unavailable();
  await tx.$queryRaw`SELECT id FROM bots WHERE id = ${target.botId} FOR SHARE`;
  const bot = await tx.bot.findFirst({
    where: { id: target.botId, spaceId: actor.spaceId, archivedAt: null },
    select: { spawnKey: true },
  });
  if (bot?.spawnKey !== `pm:${inspection.projectId}`) return unavailable();
}
