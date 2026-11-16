// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectStage } from "./hierarchy-rail";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./building-map", () => {
  throw new Error("Failed to fetch dynamically imported module");
});
vi.mock("./create-project", () => ({ CreateProject: () => null }));
vi.mock("./project-commercial", () => ({
  useProjectCommercial: () => ({ isPending: false, isError: false, data: null }),
  CommercialPanel: () => null,
}));
vi.mock("./project-manager", () => ({ ProjectManagerAction: () => null }));
it("keeps building navigation when the lazy map module cannot load", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectStage
          scope={{ userId: "user", spaceId: "space" }}
          selection={{ botId: "pm", revision: 1, buildingId: "north", projectId: "roof" }}
          tab="space"
          onTabChange={() => {}}
          data={{
            bindingRevision: 1,
            client: { id: "client", name: "Example" },
            buildings: [
              {
                id: "north",
                name: "North Building",
                latitude: 0,
                longitude: 0,
                projects: [{ id: "roof", name: "Roof survey", url: "https://example.test/roof" }],
              },
            ],
          }}
          loading={false}
          error={false}
          retry={() => {}}
        />,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("North Building");
    expect(container.querySelector('[aria-label="Building map"]')).toBeNull();
    expect(container.querySelector("[aria-expanded]")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    errors.mockRestore();
    vi.unstubAllGlobals();
  }
});
