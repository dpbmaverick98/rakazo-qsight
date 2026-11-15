import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArtifactStage } from "./artifact-stage";
import { artifactStageFixture } from "./artifact-stage.fixture";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
function render(activeId: string) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <ArtifactStage
        state={{ ...artifactStageFixture, activeId }}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    </I18nProvider>,
  );
}
describe("artifact stage", () => {
  it("renders document metadata and concise accessible controls", () => {
    const html = render("documents");
    expect(html).toContain("Project brief");
    expect(html).toContain("v2");
    expect(html).toContain('aria-label="Artifact history"');
    expect(html).toContain('aria-label="Close panel"');
  });
  it("uses a safe fallback for unknown kinds and invalid selections", () => {
    expect(render("future")).toContain("supported yet");
    expect(render("future")).not.toContain("Project brief");
    expect(render("missing")).toContain("Artifact unavailable");
  });
});
