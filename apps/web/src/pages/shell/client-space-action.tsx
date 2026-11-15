import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { CreatedProject, Hierarchy } from "@rakazo/contracts/hierarchy";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { rpcForSpace } from "../../lib/rpc";
import { CreateBuilding } from "./create-building";
import { CreateProject } from "./create-project";

export function ClientSpaceAction({
  action,
  spaceId,
  hierarchy,
  onClose,
  onOpenBot,
  refreshRoster,
}: {
  action: "building" | "project";
  spaceId: string;
  hierarchy: Hierarchy;
  onClose: () => void;
  onOpenBot: (bot: Bot) => void;
  refreshRoster: () => Promise<void>;
}) {
  const { t } = useLingui();
  const id = useId();
  const queries = useQueryClient();
  const [buildingId, setBuildingId] = useState(
    action === "building" ? "" : (hierarchy.buildings[0]?.id ?? ""),
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
  async function provision(project: Pick<CreatedProject, "id" | "name">) {
    setBusy(true);
    try {
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
            onCreated={(building) => {
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
                if (event.target.value === "") setNewBuilding(true);
                else setBuildingId(event.target.value);
              }}
            >
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
              <option value="">{t`New building`}</option>
            </select>
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
          </>
        )}
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
