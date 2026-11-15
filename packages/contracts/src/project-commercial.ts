import { z } from "zod";

const Id = z
  .string()
  .min(1)
  .max(200)
  .refine((id) => id !== "." && id !== "..");
const Text = z.string().trim().min(1).max(500);
const Money = z
  .union([
    z.number().finite(),
    z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .max(100),
  ])
  .nullable();
const Link = z.url({ protocol: /^https?$/ });

/** Canonical read-only projection. Amounts are never calculated by the consumer. */
export const ProjectCommercialSchema = z.object({
  project: z.object({
    id: Id,
    name: Text,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    url: Link,
  }),
  claims: z
    .array(
      z.object({
        id: Id,
        name: Text,
        sub_vendors: z
          .array(
            z.object({
              id: Id,
              name: Text,
              work_packages: z
                .array(
                  z.object({
                    id: Id,
                    title: Text,
                    status: Text,
                    document_count: z.number().int().nonnegative(),
                    document_state: Text,
                    proposed: Money,
                    breakdown: Money,
                    invoiced: Money,
                    remaining: Money,
                    position: Text.nullable(),
                    issues_open: z.number().int().nonnegative().nullable(),
                    coverage_incomplete: z.boolean().nullable(),
                    url: Link,
                  }),
                )
                .max(500),
            }),
          )
          .max(500),
      }),
    )
    .max(500),
});
export type ProjectCommercial = z.infer<typeof ProjectCommercialSchema>;
