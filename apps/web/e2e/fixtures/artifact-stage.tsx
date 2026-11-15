import { I18nProvider } from "@lingui/react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { ResizableSidePanel } from "../../src/pages/ResizableSidePanel";
import { ArtifactStage } from "../../src/pages/shell/artifact-stage";
import { artifactStageFixture } from "../../src/pages/shell/artifact-stage.fixture";
import { useRightPanel } from "../../src/pages/shell/use-right-panel";
import "../../src/styles.css";

function Fixture() {
  const rightPanel = useRightPanel({
    searchParams: new URLSearchParams(),
    setSearchParams: () => undefined,
  });
  useEffect(() => {
    rightPanel.publishStage(artifactStageFixture);
  }, []);
  const open = rightPanel.panel === "artifact-stage";
  return (
    <main className="relative flex h-dvh justify-end">
      <ResizableSidePanel open={open} panel="artifact-stage">
        {open ? (
          <div className="rk-scroll h-full overflow-y-auto px-5 py-[17px]">
            <ArtifactStage
              state={rightPanel.artifactStage}
              onSelect={rightPanel.selectArtifact}
              onClose={() => rightPanel.setPanel(null)}
            />
          </div>
        ) : null}
      </ResizableSidePanel>
    </main>
  );
}
void bootstrapI18n("en").then(() =>
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <Fixture />
    </I18nProvider>,
  ),
);
