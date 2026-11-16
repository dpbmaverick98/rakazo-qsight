import type { Space } from "@rakazo/contracts";
import type { ClientNavigation } from "@rakazo/contracts/hierarchy";
import { describe, expect, it } from "vitest";
import {
  clientLandingTarget,
  clientNavigationGroups,
  resolveProjectManager,
  unavailableClientNavigation,
} from "./client-navigation";
import { sidebarGroupsForSpaces } from "./space-sidebar";

const bots = ["manager", "setup", "legacy"].map((id) => ({
  id,
  spaceId: "space",
  name: id,
  pinned: true,
  sectionId: null,
  preview: "",
  unread: true,
})) as Space["bots"];
const space = { id: "space", name: "Client", bots, groups: [], botSections: [], canRename: true };
const navigation: ClientNavigation = {
  spaceId: "space",
  bindingRevision: 1,
  client: { id: "client", name: "Client" },
  setupBotIds: ["setup"],
  buildings: [
    {
      id: "building",
      name: "North",
      projects: [
        { id: "project", name: "Roof", botIds: ["manager"] },
        { id: "empty", name: "Empty", botIds: [] },
      ],
    },
  ],
};
const groups = () => sidebarGroupsForSpaces([space], "");
describe("canonical client navigation", () => {
  it("groups pinned PMs once, retains empty nodes and collapses legacy bots", () => {
    const result = clientNavigationGroups(groups(), navigation, "");
    expect(result.map((group) => group.title)).toEqual(["Client", "North", "Pinned"]);
    expect(result.map((group) => group.depth)).toEqual([0, 1, 1]);
    expect(result.flatMap((group) => group.bots.map((item) => item.chat.id))).toEqual([
      "setup",
      "manager",
      "legacy",
    ]);
    expect(result[0]?.bots[0]?.chat.name).toBe("Proj. Manager - Sam");
    expect(result.at(-1)?.defaultCollapsed).toBe(true);
    expect(result.find((group) => group.title === "North")?.bots[0]?.chat.unread).toBe(true);
  });
  it("shows ancestor context for bot, project and building searches", () => {
    for (const query of ["manager", "Roof", "North", "Roof - PM"]) {
      const filtered = sidebarGroupsForSpaces([space], query);
      const result = clientNavigationGroups(filtered, navigation, query, groups());
      expect(result.map((group) => group.title)).toContain("Client");
      expect(result.map((group) => group.title)).toContain("North");
      expect(result.find((group) => group.title === "North")?.bots[0]?.chat.name).toBe("Roof - PM");
      expect(result.every((group) => group.forceOpen)).toBe(true);
      expect(result.find((group) => group.title === "North")?.bots[0]?.chat.id).toBe("manager");
    }
  });
  it("keys expansion by Space and binding revision rather than labels", () => {
    const first = clientNavigationGroups(groups(), navigation, "");
    const next = clientNavigationGroups(groups(), { ...navigation, bindingRevision: 2 }, "");
    expect(first.every((group) => !next.some((node) => node.key === group.key))).toBe(true);
    expect(first.find((group) => group.title === "North")?.ancestors).toEqual(
      first.slice(0, 1).map((group) => group.key),
    );
  });
  it("keeps roster order within a building without duplicating managers", () => {
    const source = groups();
    const result = clientNavigationGroups(
      source,
      {
        ...navigation,
        buildings: [
          {
            ...navigation.buildings[0]!,
            projects: [
              { id: "second", name: "Second", botIds: ["legacy"] },
              ...navigation.buildings[0]!.projects,
            ],
          },
        ],
      },
      "",
    );
    expect(
      result
        .filter((group) => group.buildingId)
        .flatMap((group) => group.bots.map((item) => item.chat.id)),
    ).toEqual(["legacy", "manager"]);
  });
  it("keeps buildings without projects and preserves custom sections", () => {
    const custom = {
      ...space,
      botSections: [{ id: "notes", name: "Notes" }],
      bots: bots.map((bot) =>
        bot.id === "legacy" ? { ...bot, pinned: false, sectionId: "notes" } : bot,
      ),
    };
    const source = sidebarGroupsForSpaces([custom], "");
    const result = clientNavigationGroups(
      source,
      {
        ...navigation,
        buildings: [...navigation.buildings, { id: "vacant", name: "South", projects: [] }],
      },
      "",
    );
    expect(result.find((group) => group.title === "South")?.bots).toEqual([]);
    expect(
      result.find((group) => group.sectionId === "notes")?.bots.map((item) => item.chat.id),
    ).toEqual(["legacy"]);
    expect(
      result.flatMap((group) => group.bots).filter((item) => item.chat.id === "manager"),
    ).toHaveLength(1);
  });
  it("leaves other and legacy Spaces alone, even with identical labels", () => {
    const other = {
      ...space,
      id: "other",
      bots: [{ ...bots[0]!, id: "other-manager", spaceId: "other" }],
    };
    const original = sidebarGroupsForSpaces([space, other], "");
    expect(clientNavigationGroups(original, null, "")).toBe(original);
    const result = clientNavigationGroups(original, navigation, "");
    expect(result.filter((group) => group.spaceId === "other")).toEqual(
      original.filter((group) => group.spaceId === "other"),
    );
    expect(
      result
        .filter((group) => group.spaceId === "space")
        .flatMap((group) => group.bots.map((item) => item.chat.id)),
    ).not.toContain("other-manager");
  });
});

it("keeps legacy building conversations out of project headings, then places the promoted PM once", () => {
  const building = navigation.buildings[0]!;
  const before = clientNavigationGroups(
    groups(),
    { ...navigation, buildings: [{ ...building, botIds: ["manager"], projects: [] }] },
    "",
  );
  expect(before.find((group) => group.title === "North")).toMatchObject({
    buildingId: "building",
    canOpenSpaceSettings: false,
    bots: [],
  });
  const after = clientNavigationGroups(groups(), navigation, "");
  expect(after.find((group) => group.title === "North")?.bots[0]?.chat.name).toBe("Roof - PM");
  expect(
    after.flatMap((group) => group.bots).filter((item) => item.chat.id === "manager"),
  ).toHaveLength(1);
});
it("resolves a direct bot route through canonical ancestry, never display names", () => {
  expect(resolveProjectManager(navigation, "manager")).toEqual({
    spaceId: "space",
    bindingRevision: 1,
    clientId: "client",
    buildingId: "building",
    projectId: "project",
    botId: "manager",
  });
  for (const id of ["setup", "legacy", "Roof", undefined])
    expect(resolveProjectManager(navigation, id)).toBeNull();
  expect(resolveProjectManager(null, "manager")).toBeNull();
});
it("fails closed for duplicate or ambiguous assignments", () => {
  for (const projects of [
    [{ id: "project", name: "Roof", botIds: ["manager", "legacy"] }],
    [
      { id: "project", name: "Roof", botIds: ["manager"] },
      { id: "other", name: "Roof", botIds: ["manager"] },
    ],
  ]) {
    const ambiguous = { ...navigation, buildings: [{ ...navigation.buildings[0]!, projects }] };
    expect(resolveProjectManager(ambiguous, "manager")).toBeNull();
    expect(
      clientNavigationGroups(groups(), ambiguous, "")
        .flatMap((group) => group.bots)
        .some((item) => item.chat.id === "manager"),
    ).toBe(false);
  }
});

it("keeps failed bound navigation unavailable rather than falling back to the roster", () => {
  const result = unavailableClientNavigation(groups(), "space");
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ spaceId: "space", bots: [], unavailable: true });
});

it("moves the same active setup PM under its building and resolves the project stage after promotion", () => {
  const before = {
    ...navigation,
    buildings: [
      { ...navigation.buildings[0]!, projects: [{ id: "project", name: "Roof", botIds: [] }] },
    ],
  };
  expect(resolveProjectManager(before, "setup")).toBeNull();
  expect(clientNavigationGroups(groups(), before, "")[0]!.bots[0]!.chat.id).toBe("setup");
  const after = {
    ...before,
    setupBotIds: [],
    buildings: [
      { ...before.buildings[0]!, projects: [{ id: "project", name: "Roof", botIds: ["setup"] }] },
    ],
  };
  const result = clientNavigationGroups(groups(), after, "");
  expect(result[0]!.bots).toHaveLength(0);
  const manager = result.find((group) => group.buildingId === "building")!.bots[0]!.chat;
  expect(manager).toMatchObject({ id: "setup", name: "Roof - PM" });
  expect(
    result.flatMap((group) => group.bots).filter((item) => item.chat.id === "setup"),
  ).toHaveLength(1);
  expect(resolveProjectManager(after, "setup")).toMatchObject({
    botId: "setup",
    buildingId: "building",
    projectId: "project",
  });
});

describe("bare app client landing", () => {
  const input = () => ({
    loaded: true,
    selectedSpaceId: null,
    bots: [],
    spaces: [
      { ...space, id: "default", isDefault: true, bots: [] },
      { ...space, isDefault: false },
    ],
    navigations: [{ isPending: false, isFetching: false, data: navigation }],
  });
  it("leaves an empty default Space for the client's setup PM", () => {
    expect(clientLandingTarget(input())).toEqual({ spaceId: "space", path: "/app/setup" });
  });
  it("prefers a project PM when there is no setup PM", () => {
    const value = input();
    value.navigations[0]!.data = { ...navigation, setupBotIds: [] };
    expect(clientLandingTarget(value)?.path).toBe("/app/manager");
  });
  it("uses the first bot when no canonical assignment is available", () => {
    expect(clientLandingTarget({ ...input(), navigations: [] })?.path).toBe("/app/manager");
  });
  it("keeps the no-client landing", () => {
    expect(clientLandingTarget({ ...input(), spaces: input().spaces.slice(0, 1) })).toBeUndefined();
  });
  it.each([
    { loaded: false },
    { selectedSpaceId: "default" },
    { selectedSpaceId: "space" },
    { botId: "requested" },
    { groupId: "requested" },
    { bots: [{ id: "existing" }] },
    { navigations: [{ isPending: true, isFetching: true }] },
  ])("preserves an explicit destination or unfinished load: %j", (override) => {
    expect(clientLandingTarget({ ...input(), ...override })).toBeUndefined();
  });
});
