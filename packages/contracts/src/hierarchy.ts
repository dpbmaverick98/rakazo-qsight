import { z } from "zod";

const Name = z.string().trim().min(1).max(500);
const Id = z.string().min(1).max(200);

/** Navigation supplied by an optional external hierarchy service. */
export const HierarchySchema = z.object({
  canManage: z.boolean().optional(),
  bindingRevision: z.number().int().positive().optional(),
  client: z.object({ id: Id, name: Name }),
  buildings: z
    .array(
      z.object({
        id: Id,
        name: Name,
        address: z.string().trim().min(1).max(2000).nullable().optional(),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        projects: z
          .array(z.object({ id: Id, name: Name, url: z.url({ protocol: /^https?$/ }) }))
          .max(5000),
      }),
    )
    .max(5000),
});
export type Hierarchy = z.infer<typeof HierarchySchema>;

export const CreateProjectSchema = z
  .object({
    buildingId: Id.refine((id) => id !== "." && id !== ".."),
    name: Name.max(200),
  })
  .strict();
export const CreatedProjectSchema = z.object({
  botId: Id.optional(),
  id: Id,
  name: Name,
  currency: z.string().min(1).max(20),
  building_id: Id,
  url: z.url({ protocol: /^https?$/ }),
});
export type CreatedProject = z.infer<typeof CreatedProjectSchema>;

/** Omit externalClientId to unbind. Revision zero is only valid before the first bind. */
export const ChangeClientBindingSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    externalClientId: Id.trim().min(1).optional(),
  })
  .strict();

/** One-field setup; the Space name shares the native Space length limit. */
export const CreateClientSchema = z.object({ name: Name.max(60) }).strict();
export const ClientSetupSchema = z.object({
  clientId: Id,
  spaceId: Id,
  botId: Id,
  serverId: Id.nullable(),
  status: z.enum(["ready", "mcp_missing"]),
});
export type ClientSetup = z.infer<typeof ClientSetupSchema>;

export const LocationQuerySchema = z.object({ query: z.string().trim().min(3).max(300) }).strict();
const Location = z.object({
  address: z.string().min(1).max(2000),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  attribution: z.string().max(4000),
  verification_token: z.string().min(1).max(12000),
});
export const LocationCandidatesSchema = z.object({
  items: z.array(Location.extend({ selectable: z.boolean() })).max(5),
  attribution: z.string().max(4000),
});
export const LocationProofInputSchema = z
  .object({ verification_token: z.string().min(1).max(12000) })
  .strict();
export const LocationProofSchema = Location.extend({
  location_precision: z.string().min(1).max(100),
  expires_in: z.number().int().positive(),
});
export const CreateBuildingSchema = z
  .object({
    address: z.string().min(1).max(2000),
    verification_token: z.string().min(1).max(12000),
    nickname: z.string().trim().max(200).default(""),
  })
  .strict();
export const CreatedBuildingSchema = z.object({
  botId: Id.optional(),
  id: Id,
  name: z.string().max(200),
  address: z.string().min(1).max(2000),
  url: z.url({ protocol: /^https?$/ }),
});
export type LocationCandidates = z.infer<typeof LocationCandidatesSchema>;
export type LocationProof = z.infer<typeof LocationProofSchema>;
export type CreateBuilding = z.infer<typeof CreateBuildingSchema>;
export type CreatedBuilding = z.infer<typeof CreatedBuildingSchema>;

export const HierarchyOperationIdSchema = z.uuid();

/** Canonical assignments, projected only after current Space authorization. */
export const ClientNavigationSchema = z.object({
  spaceId: Id,
  bindingRevision: z.number().int().positive(),
  client: z.object({ id: Id, name: Name }),
  setupBotIds: z.array(Id),
  buildings: z.array(
    z.object({
      id: Id,
      name: Name,
      botIds: z.array(Id).optional(),
      projects: z.array(z.object({ id: Id, name: Name, botIds: z.array(Id) })),
    }),
  ),
});
export type ClientNavigation = z.infer<typeof ClientNavigationSchema>;

/** Exact confirmation preserves whitespace; rename normalizes a newly entered name. */
export const ProjectMutationSchema = z
  .object({
    projectId: Id.refine((id) => id !== "." && id !== ".."),
    name: z.string().min(1).max(500),
  })
  .strict();
export const RenameProjectSchema = ProjectMutationSchema.extend({ name: Name.max(200) });
