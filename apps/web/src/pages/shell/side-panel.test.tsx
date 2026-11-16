import type { ClientNavigation, Hierarchy } from "@rakazo/contracts/hierarchy";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactStageFixture } from "./artifact-stage.fixture";
import { ShellSidePanel } from "./side-panel";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("../ResizableSidePanel", () => ({
  ResizableSidePanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <aside>{children}</aside> : null,
}));
const hierarchyMock = vi.hoisted(() => ({
  data: undefined as Hierarchy | undefined,
  rail: vi.fn(),
}));
beforeEach(() => {
  hierarchyMock.data = undefined;
  hierarchyMock.rail.mockClear();
});
vi.mock("./hierarchy-rail", () => ({
  useHierarchy: () => ({ data: hierarchyMock.data, isFetching: false, isError: false }),
  HierarchyRail: (props: unknown) => {
    hierarchyMock.rail(props);
    return <div>hierarchy-rail</div>;
  },
}));
vi.mock("./bot-panel", () => ({
  BotSettings: ({ tab }: { tab: string }) => <div>bot-tab:{tab}</div>,
}));
vi.mock("../GroupPanel", () => ({
  CreateGroupForm: () => <div>create-group</div>,
  GroupSettings: () => <div>group-settings</div>,
}));
vi.mock("../RoutineEditor", () => ({ RoutineEditor: () => <div>routine-editor</div> }));
vi.mock("./agent-import", () => ({ AgentImportForm: () => <div>import-agent</div> }));
vi.mock("../../components/pages/PagesList", () => ({ PagesList: () => null }));
vi.mock("../../components/ComputerMaintenanceActions", () => ({
  ComputerMaintenanceActions: () => null,
}));

function render(
  panel: ComponentProps<typeof ShellSidePanel>["panel"],
  group = false,
  hierarchy = false,
  overrides: Partial<ComponentProps<typeof ShellSidePanel>> = {},
) {
  const props = {
    hierarchyScope: { userId: null, spaceId: null, enabled: hierarchy },
    panel,
    setPanel: () => undefined,
    active: group ? undefined : { id: "bot" },
    activeGroup: group ? { id: "group" } : undefined,
    bots: [],
    groups: [],
    artifactStage: artifactStageFixture,
    onSelectArtifact: () => undefined,
    routineEditorProps: {},
    ...overrides,
  } as unknown as ComponentProps<typeof ShellSidePanel>;
  return renderToStaticMarkup(<ShellSidePanel {...props} />);
}
describe("shell panel dispatch", () => {
  it.each(["computer", "routines", "pages", "settings"] as const)(
    "preserves the %s tab with a stage available",
    (panel) => {
      const html = render(panel);
      expect(html).toContain(`bot-tab:${panel}`);
      expect(html).not.toContain("Project documents");
    },
  );
  it.each([
    ["create-group", "create-group"],
    ["group-settings", "group-settings"],
    ["routine", "routine-editor"],
    ["import-agent", "import-agent"],
  ] as const)("preserves %s", (panel, marker) => {
    expect(render(panel, true)).toContain(marker);
  });
  it("preserves the hierarchy rail beside the stage and after close", () => {
    expect(render("artifact-stage", false, true)).toContain("hierarchy-rail");
    expect(render("artifact-stage", false, true)).toContain("Project brief");
    expect(render(null, false, true)).toContain("hierarchy-rail");
    expect(render(null, false, true)).not.toContain("Project brief");
  });
  it("shows the artifact instead of bot settings, and closes completely", () => {
    expect(render("artifact-stage")).toContain("Project brief");
    expect(render("artifact-stage", true)).toContain("Project brief");
    expect(render("artifact-stage")).not.toContain("bot-tab:");
    expect(render(null)).toBe("");
  });
});

it("anchors direct bot routes to one current client/building/project and clears stale scope", () => {
  const navigation: ClientNavigation = {
    spaceId: "space",
    bindingRevision: 2,
    client: { id: "client", name: "Client" },
    setupBotIds: ["setup"],
    buildings: [
      { id: "north", name: "North", projects: [{ id: "roof", name: "Roof", botIds: ["manager"] }] },
      {
        id: "south",
        name: "South",
        projects: [{ id: "other", name: "Roof", botIds: ["other-manager"] }],
      },
    ],
  };
  hierarchyMock.data = {
    ...navigation,
    buildings: navigation.buildings.map((building) => ({
      ...building,
      projects: building.projects.map((project) => ({
        ...project,
        url: "https://example.test/project",
      })),
    })),
  };
  const props = {
    clientNavigation: navigation,
    hierarchyScope: { userId: "user", spaceId: "space", enabled: true },
    active: { id: "manager" },
  } as Partial<ComponentProps<typeof ShellSidePanel>>;
  render(null, false, true, props);
  expect(hierarchyMock.rail.mock.lastCall?.[0]).toMatchObject({
    projectId: "roof",
    data: { buildings: [{ id: "north", projects: [{ id: "roof" }] }] },
  });
  for (const activeId of ["setup", "legacy", "missing"]) {
    render(null, false, true, {
      ...props,
      active: { id: activeId } as ComponentProps<typeof ShellSidePanel>["active"],
    });
    expect(hierarchyMock.rail.mock.lastCall?.[0].data).toBeUndefined();
  }
  render(null, false, true, { ...props, clientNavigation: { ...navigation, bindingRevision: 3 } });
  expect(hierarchyMock.rail.mock.lastCall?.[0]).toMatchObject({ data: undefined, error: true });
  render(null, false, true, { ...props, clientNavigation: null, navigationError: true });
  expect(hierarchyMock.rail.mock.lastCall?.[0]).toMatchObject({ data: undefined, error: true });
});
