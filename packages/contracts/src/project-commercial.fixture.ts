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

export const commercialDocumentsFixture: ProjectCommercial = structuredClone(commercialFixture);
commercialDocumentsFixture.claims[0]!.totals = {
  proposed: null,
  breakdown: "1234.50",
  invoiced: "0",
  remaining: "1234.50",
};
commercialDocumentsFixture.claims[0]!.sub_vendors[0]!.work_packages[0]!.documents = [
  {
    id: "proposal",
    filename: "Proposal.pdf",
    role: "proposal",
    content_type: "application/pdf",
    size_bytes: 1200,
    status: "ready",
    created_at: "2026-01-01T00:00:00Z",
    superseded_at: null,
    replacement_for_document_id: null,
    package_url: "https://hierarchy.example.test/projects/roof/packages/drywall",
    url: "https://hierarchy.example.test/projects/roof/packages/drywall?document=proposal",
  },
  {
    id: "invoice",
    filename: "Invoice.pdf",
    role: "invoice",
    content_type: "application/pdf",
    size_bytes: 0,
    status: "pending",
    created_at: "2026-01-02T00:00:00Z",
    superseded_at: null,
    replacement_for_document_id: null,
    package_url: "https://hierarchy.example.test/projects/roof/packages/drywall",
    url: "https://hierarchy.example.test/projects/roof/packages/drywall?document=invoice",
  },
];

commercialDocumentsFixture.claims[0]!.sub_vendors[0]!.work_packages[0]!.document_count = 2;
