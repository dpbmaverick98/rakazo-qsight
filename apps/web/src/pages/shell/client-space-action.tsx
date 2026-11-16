import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { CreatedProject, Hierarchy } from "@rakazo/contracts/hierarchy";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { rpcForSpace } from "../../lib/rpc";
import { CreateBuilding } from "./create-building";
import { CreateProject } from "./create-project";

export function ClientSpaceAction(props: {
  action: "building" | "project";
  spaceId: string;
  buildingId?: string;
  hierarchy?: Hierarchy | null;
  loading?: boolean;
  retry?: () => void;
  onClose: () => void;
  onOpenBot: (bot: Bot) => void;
  refreshRoster: () => Promise<void>;
}) {
  const { t } = useLingui();
  if (props.hierarchy) return <ReadyClientSpaceAction {...props} hierarchy={props.hierarchy} />;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.action === "building" ? t`Add building` : t`Add project`}
          </DialogTitle>
        </DialogHeader>
        {props.loading ? (
          <p role="status">
            <Trans>Loading hierarchy…</Trans>
          </p>
        ) : (
          <>
            <p role="alert">
              <Trans>Hierarchy unavailable</Trans>
            </p>
            <Button onClick={props.retry}>
              <Trans>Retry</Trans>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadyClientSpaceAction({
  action,
  spaceId,
  buildingId: initialBuildingId,
  hierarchy,
  onClose,
  onOpenBot,
  refreshRoster,
}: {
  action: "building" | "project";
  spaceId: string;
  hierarchy: Hierarchy;
  buildingId?: string;
  onClose: () => void;
  onOpenBot: (bot: Bot) => void;
  refreshRoster: () => Promise<void>;
}) {
  const { t } = useLingui();
  const id = useId();
  const queries = useQueryClient();
  const [buildingId, setBuildingId] = useState(
    action === "building"
      ? ""
      : (initialBuildingId ?? (hierarchy.buildings.length === 1 ? hierarchy.buildings[0]!.id : "")),
  );
  const [newBuilding, setNewBuilding] = useState(
    action === "building" || !hierarchy.buildings.length,
  );
  const [createdBuilding, setCreatedBuilding] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const initialProjects = useRef(hierarchy.buildings.flatMap((building) => building.projects));
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ["hierarchy"] });
    void queries.invalidateQueries({ queryKey: ["client-navigation"] });
  };
  async function openManager(botId: string) {
    refresh();
    await refreshRoster();
    const bots = await rpcForSpace(spaceId).bots.list({});
    const bot = bots.find((item) => item.id === botId);
    if (!bot) throw new Error("Manager unavailable");
    onOpenBot(bot);
    onClose();
  }
  async function provision(project: Pick<CreatedProject, "id" | "name" | "botId">) {
    setBusy(true);
    try {
      if (project.botId) {
        await openManager(project.botId);
        return;
      }
      const { bot } = await rpcForSpace(spaceId).mcp.servers.provisionProjectManager({
        projectId: project.id,
        projectName: project.name,
        clientName: hierarchy.client.name,
        bindingRevision: hierarchy.bindingRevision,
        ...(initialProjects.current.length === 0 ||
        (initialProjects.current.length === 1 && initialProjects.current[0]?.id === project.id)
          ? { finishSetup: true }
          : {}),
      });
      refresh();
      await refreshRoster();
      onOpenBot(bot);
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{newBuilding ? t`Add building` : t`Add project`}</DialogTitle>
        </DialogHeader>
        {newBuilding ? (
          <CreateBuilding
            spaceId={spaceId}
            bindingRevision={hierarchy.bindingRevision}
            refresh={refresh}
            initiallyOpen
            onBusyChange={setBusy}
            onCreated={async (building) => {
              if (action === "building" && building.botId) {
                await openManager(building.botId);
                return;
              }
              setCreatedBuilding(building);
              setBuildingId(building.id);
              setNewBuilding(false);
            }}
          />
        ) : (
          <>
            <label htmlFor={id}>
              <Trans>Building</Trans>
            </label>
            <select
              id={id}
              className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-foreground"
              value={buildingId}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value === "new") setNewBuilding(true);
                else setBuildingId(event.target.value);
              }}
            >
              <option value="" disabled>{t`Select building`}</option>
              {[
                ...hierarchy.buildings,
                ...(createdBuilding &&
                !hierarchy.buildings.some((building) => building.id === createdBuilding.id)
                  ? [createdBuilding]
                  : []),
              ].map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
              <option value="new">{t`New building`}</option>
            </select>
            {buildingId ? (
              <CreateProject
                existingProjects={
                  hierarchy.buildings.find((building) => building.id === buildingId)?.projects
                }
                key={buildingId}
                buildingId={buildingId}
                spaceId={spaceId}
                bindingRevision={hierarchy.bindingRevision}
                refresh={refresh}
                initiallyOpen
                onBusyChange={setBusy}
                onCreated={provision}
              />
            ) : null}
          </>
        )}
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
