import { expect, it } from "vitest";
import { HierarchySchema } from "./hierarchy.js";

const building = { id: "north", name: "North", projects: [] };
const parse = (coordinates: object) =>
  HierarchySchema.parse({
    client: { id: "client", name: "Client" },
    buildings: [{ ...building, ...coordinates }],
  }).buildings[0];

it("accepts nullable, missing and boundary coordinates while stripping addresses", () => {
  expect(parse({ latitude: 0, longitude: 0, address: "omit" })).toEqual({
    ...building,
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
