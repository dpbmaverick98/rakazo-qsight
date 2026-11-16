import { expect, it } from "vitest";
import { projectIntakeFixture as fixture } from "./project-intake.fixture.js";
import {
  CompleteIntakeFileBodySchema,
  CompletionResponseSchema,
  ProjectIntakeManifestFilesSchema,
  ProjectIntakeViewSchema,
} from "./project-intake.js";

it("parses the v1.0.0 producer manifest, view and completion exchange offline", () => {
  const files = ProjectIntakeManifestFilesSchema.parse(fixture.request.files);
  const view = ProjectIntakeViewSchema.parse(fixture.response);
  expect(view.project_id).toBe(fixture.request.project_id);
  expect(view.files[0]!.client_id).toBe(files[0]!.source_file_id);
  expect(view).toEqual(fixture.response);
  expect(CompleteIntakeFileBodySchema.parse(fixture.complete_request)).toEqual(
    fixture.complete_request,
  );
  expect(CompletionResponseSchema.parse(fixture.complete_response)).toEqual(
    fixture.complete_response,
  );
});

it.each([undefined, null, ""])("rejects file client_id %s", (client_id) => {
  expect(
    ProjectIntakeViewSchema.safeParse({
      ...fixture.response,
      files: [{ ...fixture.response.files[0], client_id }],
    }).success,
  ).toBe(false);
});

it("rejects a malformed completion hash", () => {
  expect(
    CompleteIntakeFileBodySchema.safeParse({
      ...fixture.complete_request,
      expected_source_sha256: "not-a-sha256",
    }).success,
  ).toBe(false);
});

it("tolerates unknown display extras throughout the context path", () => {
  const path = {
    client: { id: "client", name: "Client", label: "extra" },
    building: {
      id: "building",
      name: "Building",
      display_name: "Building display",
      address: "Synthetic address",
      client_id: "client",
      currency: "USD",
      location_revision: 1,
    },
    project: { ...fixture.response.path.project, currency: "USD", label: "extra" },
    label: "extra",
  };
  expect(ProjectIntakeViewSchema.parse({ ...fixture.response, path }).path).toEqual(path);
});

it.each([undefined, null, ""])("accepts missing display names (%s) with a fallback", (name) => {
  const view = ProjectIntakeViewSchema.parse({
    ...fixture.response,
    path: {
      client: { id: "client", name },
      building: { id: "building", name, display_name: name, address: null },
      project: { id: "project", name },
    },
  });
  expect(view.path.client!.name).toBe("Address missing");
  expect(view.path.building!.name).toBe("Address missing");
  expect(view.path.building!.display_name).toBe("Address missing");
  expect(view.path.project.name).toBe("Address missing");
});

it.each(["client", "building", "project"] as const)("keeps %s identity strict", (kind) => {
  for (const id of [undefined, null, ""]) {
    expect(
      ProjectIntakeViewSchema.safeParse({
        ...fixture.response,
        path: { ...fixture.response.path, [kind]: { id, name: null } },
      }).success,
    ).toBe(false);
  }
});
