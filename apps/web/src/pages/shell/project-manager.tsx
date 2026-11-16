import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { Button, NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpcForSpace } from "../../lib/rpc";
export function ProjectManagerAction({
  project,
  client,
  spaceId,
  onOpenBot,
  finishSetup,
  bindingRevision,
  onChanged,
}: {
  project: Pick<ProjectCommercial["project"], "id" | "name">;
  client: string;
  spaceId: string;
  onOpenBot?: (bot: Bot) => void;
  finishSetup?: boolean;
  bindingRevision?: number;
  onChanged?: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // The parent keys this action by user, space and project. Late requests stay in their space.
  // Ref callbacks also cover unmount without introducing a data-read timer.
  const rpc = rpcForSpace(spaceId);
  function open(bot: Bot) {
    if (onOpenBot) onOpenBot(bot);
    else navigate(`/app/${encodeURIComponent(bot.id)}`);
  }
  async function provision() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const { bot } = await rpc.mcp.servers.provisionProjectManager({
        projectId: project.id,
        bindingRevision,
        projectName: project.name,
        clientName: client,
        ...(finishSetup ? { finishSetup: true } : {}),
      });
      onChanged?.();
      if (mounted.current) open(bot);
    } catch {
      if (mounted.current) setError(t`Could not create project manager. Try again.`);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <div
      ref={(node) => {
        mounted.current = node !== null;
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void provision()}
      >
        {pending ? t`Creating…` : finishSetup ? t`Finish setup` : t`Create project manager`}
      </Button>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A choice is required when setup already contains several projects. */
export function FinishSetupAction({
  hierarchy,
  spaceId,
  onOpenBot,
  onChanged,
}: {
  hierarchy: Hierarchy;
  spaceId: string;
  onOpenBot: (bot: Bot) => void;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [projectId, setProjectId] = useState("");
  const projects = hierarchy.buildings.flatMap((building) => building.projects);
  const project = projects.find((item) => item.id === projectId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">{t`Project`}</label>
      <NativeSelect
        id={id}
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <NativeSelectOption value="" disabled>{t`Select project`}</NativeSelectOption>
        {hierarchy.buildings.map((building) => (
          <NativeSelectOptGroup key={building.id} label={building.name}>
            {building.projects.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
      {project ? (
        <ProjectManagerAction
          key={project.id}
          project={project}
          client={hierarchy.client.name}
          spaceId={spaceId}
          bindingRevision={hierarchy.bindingRevision}
          finishSetup
          onOpenBot={onOpenBot}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
