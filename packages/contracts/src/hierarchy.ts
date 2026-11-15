import { z } from "zod";

const Name = z.string().trim().min(1).max(500);
const Id = z.string().min(1).max(200);

/** Read-only navigation supplied by an optional external hierarchy service. */
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
