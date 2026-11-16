import type { ClientNavigation } from "@rakazo/contracts/hierarchy";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactStageFixture } from "./artifact-stage.fixture";
import { resolveProjectManager } from "./client-navigation";
import { ShellSidePanel } from "./side-panel";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("../ResizableSidePanel", () => ({
  ResizableSidePanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <aside>{children}</aside> : null,
}));
const hierarchyMock = vi.hoisted(() => ({ data: {} as unknown, isError: false, stage: vi.fn() }));
beforeEach(() => {
  hierarchyMock.stage.mockClear();
  hierarchyMock.isError = false;
});
vi.mock("./hierarchy-rail", () => ({
  useHierarchy: () => ({
    data: hierarchyMock.data,
    isFetching: false,
    isError: hierarchyMock.isError,
  }),
  ProjectStage: (props: unknown) => {
    hierarchyMock.stage(props);
    return <div>project-stage</div>;
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

vi.mock("./project-manager", () => ({
  FinishSetupAction: () => <button type="button">Finish setup</button>,
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
    projectSelection: hierarchy
      ? {
          botId: "bot",
          revision: 1,
          spaceId: "space",
          clientId: "client",
          buildingId: "north",
          projectId: "roof",
        }
      : undefined,
    openProjectPanel: () => undefined,
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
  it("uses a mutually exclusive project stage alongside existing panels", () => {
    expect(render("project:bot:1:space", false, true)).toContain("project-stage");
    for (const panel of ["artifact-stage", "computer", "routines", "settings"] as const) {
      expect(render(panel, false, true)).not.toContain("project-stage");
    }
    expect(render("artifact-stage", false, true)).toContain("Project brief");
    expect(render(null, false, true)).not.toContain("project-stage");
    expect(render("project:other:1:claims", false, true)).not.toContain("project-stage");
  });
  it("shows the artifact instead of bot settings, and closes completely", () => {
    expect(render("artifact-stage")).toContain("Project brief");
    expect(render("artifact-stage", true)).toContain("Project brief");
    expect(render("artifact-stage")).not.toContain("bot-tab:");
    expect(render(null)).toBe("");
  });
});

it("renders valid hierarchy despite navigation errors and rejects invalid hierarchy", () => {
  const building = { id: "north", projects: [{ id: "roof" }, { id: "sibling" }] };
  hierarchyMock.data = { bindingRevision: 1, client: { id: "client" }, buildings: [building] };
  const props = {
    hierarchyScope: { userId: "user", spaceId: "space", enabled: true },
    navigationError: true,
  };
  expect(render("project:bot:1:space", false, true, props)).toContain("project-stage");
  expect(hierarchyMock.stage.mock.lastCall?.[0]).toMatchObject({
    data: { buildings: [building] },
    error: false,
  });
  for (const data of [
    { bindingRevision: 2, client: { id: "client" }, buildings: [building] },
    { bindingRevision: 1, client: { id: "other" }, buildings: [building] },
    { bindingRevision: 1, client: { id: "client" }, buildings: [] },
    { bindingRevision: 1, client: { id: "client" }, buildings: [{ id: "north", projects: [] }] },
    undefined,
  ]) {
    hierarchyMock.data = data;
    render("project:bot:1:space", false, true, props);
    expect(hierarchyMock.stage.mock.lastCall?.[0]).toMatchObject({ data: undefined, error: true });
  }
  hierarchyMock.data = { bindingRevision: 1, client: { id: "client" }, buildings: [building] };
  hierarchyMock.isError = true;
  render("project:bot:1:space", false, true, props);
  expect(hierarchyMock.stage.mock.lastCall?.[0]).toMatchObject({ data: undefined, error: true });
});

it.each([true, false])(
  "resolves the project stage after a navigation error only with retained data (%s)",
  async (retained) => {
    const navigation: ClientNavigation = {
      spaceId: "space",
      bindingRevision: 1,
      client: { id: "client", name: "Client" },
      setupBotIds: [],
      buildings: [
        { id: "north", name: "North", projects: [{ id: "roof", name: "Roof", botIds: ["bot"] }] },
      ],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const queryKey = ["client-navigation", "space"];
    if (retained) client.setQueryData(queryKey, navigation);
    const observer = new QueryObserver<ClientNavigation>(client, {
      queryKey,
      queryFn: async () => {
        throw new Error("Navigation unavailable");
      },
    });
    try {
      await observer.refetch();
      const query = observer.getCurrentResult();
      expect(query.isError).toBe(true);
      expect(query.isStale).toBe(true);
      expect(query.data).toEqual(retained ? navigation : undefined);
      const resolvedProject = resolveProjectManager(query.data, "bot");
      const projectSelection = resolvedProject
        ? { ...resolvedProject, revision: resolvedProject.bindingRevision }
        : undefined;
      expect(projectSelection?.projectId).toBe(retained ? "roof" : undefined);
      hierarchyMock.data = navigation;
      const html = render("project:bot:1:space", false, true, {
        hierarchyScope: { userId: "user", spaceId: "space", enabled: true },
        navigationError: query.isError,
        projectSelection,
      });
      expect(html.includes("project-stage")).toBe(retained);
      expect(hierarchyMock.stage).toHaveBeenCalledTimes(retained ? 1 : 0);
    } finally {
      observer.destroy();
      client.clear();
    }
  },
);

it.each([
  ["bot", true, 2, true],
  ["other", true, 2, false],
  [undefined, true, 2, false],
  ["bot", false, 2, false],
  ["bot", true, 1, false],
  ["bot", true, 0, false],
] as const)(
  "shows finish setup for setup bot %s with canManage=%s and %s projects",
  (setupBotId, canManage, projectCount, visible) => {
    hierarchyMock.data = {
      setupBotId,
      canManage,
      bindingRevision: 1,
      client: { id: "client" },
      buildings: [
        {
          id: "north",
          projects: Array.from({ length: projectCount }, (_, id) => ({ id: String(id) })),
        },
      ],
    };
    const html = render(null, false, true, {
      hierarchyScope: { userId: "user", spaceId: "space", enabled: true },
    });
    expect(html.includes("Finish setup")).toBe(visible);
  },
);
