// @vitest-environment jsdom
import type { Space } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { clientNavigationGroups } from "./client-navigation";
import { SidebarRoster } from "./sidebar-roster";
import { sidebarGroupsForSpaces } from "./space-sidebar";

const space = {
  id: "space",
  name: "Client",
  groups: [],
  botSections: [],
  bots: [
    {
      id: "manager",
      spaceId: "space",
      name: "Stored name",
      status: "idle",
      pinned: true,
      sectionId: null,
      color: "slate",
      updatedAt: new Date().toISOString(),
    },
  ],
} as unknown as Space;
afterEach(() => vi.unstubAllGlobals());
it("only expands clients and renders building headings with one selected PM route", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const source = sidebarGroupsForSpaces([space], "");
  const groups = clientNavigationGroups(
    source,
    {
      spaceId: "space",
      bindingRevision: 1,
      client: { id: "client", name: "Client" },
      setupBotIds: [],
      buildings: [
        {
          id: "north",
          name: "North",
          projects: [{ id: "roof", name: "Roof", botIds: ["manager"] }],
        },
        { id: "south", name: "South", projects: [] },
      ],
    },
    "",
  );
  const toggle = vi.fn();
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        <SidebarRoster
          sidebarGroups={groups}
          collapsedSidebarSections={new Set([groups[1]!.key])}
          bootstrapMe={{ spaceId: "space" }}
          botSections={[]}
          spaces={[space]}
          rosterDropKey={null}
          setRosterDropKey={vi.fn()}
          rosterDropAction={() => null}
          applyRosterDrop={vi.fn()}
          openSpaceChat={open}
          spaceMenuAnchor={{ current: null }}
          setSpaceMenu={vi.fn()}
          setRenameSectionTarget={vi.fn()}
          setDeleteSectionTarget={vi.fn()}
          toggleSidebarSection={toggle}
          inGroup={false}
          active={{ id: "manager" }}
          activeGroup={undefined}
          botsSidebarDensity="compact"
          dismissedRunErrorIds={new Set()}
          displayedRunError={null}
          draggedBotId={null}
          setDraggedBotId={vi.fn()}
          chatMenu={{ menu: null, setMenu: vi.fn(), content: null, has: () => false }}
          reorderRosterBot={vi.fn()}
          activeSnapshot={null}
        />,
      ),
    );
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "North",
      "South",
    ]);
    const building = container.querySelector(`[data-sidebar-group="${groups[1]!.key}"]`)!;
    expect(building.querySelector("h3 button")).toBeNull();
    expect(building.querySelector("[aria-expanded]")).toBeNull();
    const row = container.querySelector<HTMLButtonElement>('[data-roster-bot-id="manager"]')!;
    expect(row.textContent).toContain("Roof - PM");
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.draggable).toBe(false);
    await act(async () => row.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("space", "/app/manager");
    const client = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Client",
    )!;
    await act(async () => client.click());
    expect(toggle).toHaveBeenCalledExactlyOnceWith(groups[0]!.key);
    expect(open).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
