// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readRightPanelState, rightPanelStorageKey } from "../../lib/right-panel-state";
import type { RightPanel } from "./use-right-panel";
import { useRightPanel, useRightPanelRestore } from "./use-right-panel";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("restores per-PM tabs and reopens Claims after system panels without storing content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let controller: RightPanel;
  const searchParams = new URLSearchParams();
  const routines: [] = [];
  function Probe({ botId, revision = 1 }: { botId: string; revision?: number }) {
    const panel = useRightPanel({ searchParams, setSearchParams: () => {} });
    controller = panel;
    useRightPanelRestore({
      rightPanel: panel,
      userId: "user",
      spaceId: "space",
      inGroup: false,
      panelTarget: botId,
      activeId: botId,
      projectPanel: `project:${botId}:${revision}:space`,
      routines,
      routinesBotId: botId,
      searchParams,
      editingRoutineId: undefined,
      restoreRoutine: () => {},
      leaveRoutine: () => {},
    });
    return null as ReactNode;
  }
  try {
    await act(async () => root.render(<Probe botId="a" />));
    expect(controller!.panel).toBe("project:a:1:space");
    await act(async () => controller!.setPanel("project:a:1:claims"));
    await act(async () => controller!.setPanel("computer"));
    await act(async () => controller!.openProjectPanel("project:a:1:space"));
    expect(controller!.panel).toBe("project:a:1:claims");
    await act(async () => root.render(<Probe botId="b" />));
    expect(controller!.panel).toBe("project:b:1:space");
    await act(async () => root.render(<Probe botId="a" />));
    expect(controller!.panel).toBe("project:a:1:claims");
    expect(readRightPanelState(rightPanelStorageKey("user", "space", "bot", "a"))).toEqual({
      panel: "project:a:1:claims",
      projectPanel: "project:a:1:claims",
    });
    await act(async () => root.render(<Probe key="reload" botId="a" />));
    expect(controller!.panel).toBe("project:a:1:claims");
    await act(async () => root.render(<Probe key="rebound" botId="a" revision={2} />));
    expect(controller!.panel).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
