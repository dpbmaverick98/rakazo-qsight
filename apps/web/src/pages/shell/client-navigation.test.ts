import type { Space } from "@rakazo/contracts";
import type { ClientNavigation } from "@rakazo/contracts/hierarchy";
import { describe, expect, it } from "vitest";
import { clientNavigationGroups } from "./client-navigation";
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
    expect(result.map((group) => group.title)).toEqual([
      "Client",
      "North",
      "Roof",
      "Empty",
      "Unassigned",
    ]);
    expect(result.map((group) => group.depth)).toEqual([0, 1, 2, 2, 1]);
    expect(result.flatMap((group) => group.bots.map((item) => item.chat.id))).toEqual([
      "setup",
      "manager",
      "legacy",
    ]);
    expect(result.at(-1)?.defaultCollapsed).toBe(true);
    expect(result.find((group) => group.title === "Roof")?.bots[0]?.chat.unread).toBe(true);
  });
  it("shows ancestor context for bot, project and building searches", () => {
    for (const query of ["manager", "Roof", "North"]) {
      const filtered = sidebarGroupsForSpaces([space], query);
      const result = clientNavigationGroups(filtered, navigation, query, groups());
      expect(result.map((group) => group.title)).toContain("Client");
      expect(result.map((group) => group.title)).toContain("North");
      expect(result.map((group) => group.title)).toContain("Roof");
      expect(result.every((group) => group.forceOpen)).toBe(true);
      expect(result.find((group) => group.title === "Roof")?.bots[0]?.chat.id).toBe("manager");
    }
  });
  it("keys expansion by Space and binding revision rather than labels", () => {
    const first = clientNavigationGroups(groups(), navigation, "");
    const next = clientNavigationGroups(groups(), { ...navigation, bindingRevision: 2 }, "");
    expect(first.every((group) => !next.some((node) => node.key === group.key))).toBe(true);
    expect(first.find((group) => group.title === "Roof")?.ancestors).toEqual(
      first.slice(0, 2).map((group) => group.key),
    );
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
