import { expect, it } from "vitest";
import { commercialFixture } from "./project-commercial.fixture.js";
import { ProjectCommercialSchema } from "./project-commercial.js";

it("keeps old payloads and decimal, zero and null claim totals without summing packages", () => {
  expect(ProjectCommercialSchema.parse(commercialFixture)).toEqual(commercialFixture);
  const data = structuredClone(commercialFixture);
  data.claims[0]!.totals = {
    proposed: null,
    breakdown: "0",
    invoiced: "12.340",
    remaining: "-0.01",
  };
  expect(ProjectCommercialSchema.parse(data).claims[0]!.totals).toEqual(data.claims[0]!.totals);
});

it("allowlists active document metadata and strips secrets", () => {
  const data = structuredClone(commercialFixture);
  const document = {
    id: "doc",
    filename: "proposal.pdf",
    role: "proposal",
    content_type: "application/pdf",
    size_bytes: 0,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    superseded_at: null,
    replacement_for_document_id: null,
    package_url: data.claims[0]!.sub_vendors[0]!.work_packages[0]!.url,
    url: "https://hierarchy.example.test/projects/roof/packages/drywall?document=doc",
    storage_key: "secret-placeholder",
    signed_url: "secret-placeholder",
    text: "secret-placeholder",
  };
  data.claims[0]!.sub_vendors[0]!.work_packages[0]!.documents = [document];
  const parsed = ProjectCommercialSchema.parse(data);
  expect(JSON.stringify(parsed)).not.toContain("secret-placeholder");
  expect(parsed.claims[0]!.sub_vendors[0]!.work_packages[0]!.documents?.[0]?.size_bytes).toBe(0);
  document.url = "javascript:alert(1)";
  expect(ProjectCommercialSchema.safeParse(data).success).toBe(false);
});
