import { z } from "zod";

const Name = z.string().trim().min(1).max(500);
const Id = z.string().min(1).max(200);

/** Navigation supplied by an optional external hierarchy service. */
export const HierarchySchema = z.object({
  client: z.object({ id: Id, name: Name }),
  buildings: z
    .array(
      z.object({
        id: Id,
        name: Name,
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
    name: Name,
  })
  .strict();
export const CreatedProjectSchema = z.object({
  id: Id,
  name: Name,
  currency: z.string().min(1).max(20),
  building_id: Id,
  url: z.url({ protocol: /^https?$/ }),
});
export type CreatedProject = z.infer<typeof CreatedProjectSchema>;
