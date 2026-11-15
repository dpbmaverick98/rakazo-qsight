import type { ProjectCommercial } from "./project-commercial.js";

/** Synthetic data shared by offline consumer checks. */
export const commercialFixture: ProjectCommercial = {
  project: {
    id: "roof",
    name: "Roof survey",
    currency: "USD",
    url: "https://hierarchy.example.test/projects/roof",
  },
  claims: [
    {
      id: "claim",
      name: "Finishes",
      sub_vendors: [
        {
          id: "vendor",
          name: "Example Interiors",
          work_packages: [
            {
              id: "drywall",
              title: "Drywall",
              status: "active",
              document_count: 0,
              document_state: "No documents yet",
              proposed: null,
              breakdown: "1234.50",
              invoiced: null,
              remaining: null,
              position: null,
              issues_open: 0,
              coverage_incomplete: true,
              url: "https://hierarchy.example.test/projects/roof/packages/drywall",
            },
          ],
        },
      ],
    },
  ],
};
