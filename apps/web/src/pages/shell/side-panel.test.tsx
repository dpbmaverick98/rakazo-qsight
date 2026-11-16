import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
vi.mock("./hierarchy-rail", () => ({
  useHierarchy: () => ({ data: {}, isFetching: false, isError: false }),
  ProjectStage: () => <div>project-stage</div>,
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
) {
  const props = {
    hierarchyScope: { userId: null, spaceId: null, enabled: hierarchy },
    panel,
    projectSelection: hierarchy
      ? { botId: "bot", revision: 1, buildingId: "north", projectId: "roof" }
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
