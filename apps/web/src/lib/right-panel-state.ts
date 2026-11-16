export type Panel =
  | `project:${string}`
  | "artifact-stage"
  | "computer"
  | "routines"
  | "pages"
  | "settings"
  | "routine"
  | "create-group"
  | "group-settings"
  | "import-agent"
  | null;
export type RightPanelState = {
  panel: Panel;
  routineId?: string;
  projectPanel?: `project:${string}`;
};

function isProjectPanel(value: unknown): value is `project:${string}` {
  return typeof value === "string" && /^project:[^:]+:[1-9]\d*:(space|claims)$/.test(value);
}

/** Panels that are safe to remember across reloads. */
const durablePanels: readonly Panel[] = [
  "computer",
  "routines",
  "pages",
  "settings",
  "routine",
  "group-settings",
  null,
];

export function rightPanelStorageKey(
  userId: string,
  spaceId: string,
  kind: "bot" | "group",
  targetId: string,
): string {
  return `rakazo:right-panel-state:${userId}:${spaceId}:${kind}:${targetId}`;
}

export function readRightPanelState(key: string, defaultPanel: Panel = null): RightPanelState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value === null) return { panel: defaultPanel };
    if (
      !value ||
      typeof value !== "object" ||
      !("panel" in value) ||
      !(durablePanels.includes(value.panel as Panel) || isProjectPanel(value.panel))
    )
      return { panel: null };
    return {
      panel: value.panel as Panel,
      ...("projectPanel" in value && isProjectPanel(value.projectPanel)
        ? { projectPanel: value.projectPanel }
        : {}),
      ...(value.panel === "routine" &&
      "routineId" in value &&
      typeof value.routineId === "string" &&
      value.routineId
        ? { routineId: value.routineId }
        : {}),
    };
  } catch {
    return { panel: null };
  }
}

export function writeRightPanelState(key: string, panel: Panel, routineId?: string) {
  // Keep the last durable preference while create-group or an import is open.
  if (panel === "create-group" || panel === "import-agent" || panel === "artifact-stage") return;
  try {
    const projectPanel = isProjectPanel(panel) ? panel : readRightPanelState(key).projectPanel;
    localStorage.setItem(
      key,
      JSON.stringify({
        panel,
        ...(projectPanel ? { projectPanel } : {}),
        ...(panel === "routine" && routineId ? { routineId } : {}),
      }),
    );
  } catch {
    // Restricted storage must not prevent opening or closing the panel.
  }
}
