import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ArtifactRendererRegistry,
  ArtifactStageState,
  StageArtifact,
} from "@rakazo/contracts";
import {
  ArtifactStageStateSchema,
  DocumentListPayloadSchema,
  selectArtifactRenderer,
} from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SectionHeading,
} from "@rakazo/ui-web";
import { ChevronDown, X } from "lucide-react";
import type { ReactNode } from "react";

const renderers: ArtifactRendererRegistry<(artifact: StageArtifact) => ReactNode> = new Map([
  [
    "document-list:1",
    (artifact) => {
      const { documents } = DocumentListPayloadSchema.parse(artifact.payload);
      return documents.length ? (
        <ul className="flex flex-col gap-3">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-baseline justify-between gap-3 text-body-sm"
            >
              <span className="min-w-0 break-words">{document.name}</span>
              <span className="shrink-0 text-muted-foreground">v{document.version}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          <Trans>No documents</Trans>
        </p>
      );
    },
  ],
]);

export function ArtifactStageContent({ artifact }: { artifact: StageArtifact }) {
  const render = selectArtifactRenderer(renderers, artifact);
  return render ? (
    render(artifact)
  ) : (
    <p className="text-body-sm text-muted-foreground">
      <Trans>This artifact isn't supported yet.</Trans>
    </p>
  );
}

/** Validate at the UI boundary; unknown payloads are never inspected or printed. */
export function ArtifactStage({
  state,
  onSelect,
  onClose,
}: {
  state: ArtifactStageState;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const parsed = ArtifactStageStateSchema.safeParse(state);
  const active = parsed.success
    ? parsed.data.artifacts.find((artifact) => artifact.id === parsed.data.activeId)
    : undefined;
  return (
    <section className="flex flex-col gap-4" aria-label={t`Artifact stage`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words">
          <SectionHeading>{active?.title ?? t`Artifact`}</SectionHeading>
          {active?.subtitle ? (
            <p className="text-body-sm text-muted-foreground">{active.subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {parsed.success && parsed.data.artifacts.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={t`Artifact history`} />}
              >
                <ChevronDown size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  {parsed.data.artifacts.map((artifact) => (
                    <DropdownMenuItem
                      key={artifact.id}
                      onClick={() => onSelect(artifact.id)}
                      aria-current={artifact.id === active?.id ? "true" : undefined}
                    >
                      {artifact.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label={t`Close panel`} onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
      </div>
      {active ? (
        <ArtifactStageContent artifact={active} />
      ) : (
        <p role="status" className="text-body-sm text-muted-foreground">
          <Trans>Artifact unavailable</Trans>
        </p>
      )}
    </section>
  );
}
