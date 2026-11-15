import { expect, it } from "vitest";
import { ChangeClientBindingSchema, HierarchySchema } from "./hierarchy.js";

const building = { id: "north", name: "North", projects: [] };
const parse = (coordinates: object) =>
  HierarchySchema.parse({
    client: { id: "client", name: "Client" },
    buildings: [{ ...building, ...coordinates }],
  }).buildings[0];

it("accepts nullable, missing and boundary coordinates and preserves building addresses", () => {
  expect(parse({ latitude: 0, longitude: 0, address: "Example Street" })).toEqual({
    ...building,
    address: "Example Street",
    latitude: 0,
    longitude: 0,
  });
  expect(parse({ latitude: null, longitude: null })).toMatchObject({
    latitude: null,
    longitude: null,
  });
  expect(parse({})).toEqual(building);
  expect(parse({ latitude: -90, longitude: 180 })).toMatchObject({ latitude: -90, longitude: 180 });
});
it.each([{ latitude: 91 }, { longitude: -181 }, { latitude: Infinity }, { longitude: "12" }])(
  "rejects invalid coordinates %j",
  (coordinates) => {
    expect(() => parse(coordinates)).toThrow();
  },
);

it("binding commands require a revision and explicit ID, rejecting display name authority", () => {
  expect(ChangeClientBindingSchema.parse({ revision: 0, externalClientId: "client-7" })).toEqual({
    revision: 0,
    externalClientId: "client-7",
  });
  expect(ChangeClientBindingSchema.parse({ revision: 2 })).toEqual({ revision: 2 });
  for (const input of [
    { revision: -1 },
    { externalClientId: "client" },
    { revision: 0, clientName: "Other" },
    { revision: 0, externalClientId: " " },
  ])
    expect(ChangeClientBindingSchema.safeParse(input).success).toBe(false);
});
