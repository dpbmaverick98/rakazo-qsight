import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";

export function ProjectMutationDialog({
  action,
  project,
  spaceId,
  bindingRevision,
  onClose,
}: {
  action: "rename" | "delete";
  project: { id: string; name: string };
  spaceId: string;
  bindingRevision?: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const queries = useQueryClient();
  const id = useId();
  const [name, setName] = useState(action === "rename" ? project.name : "");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState(false);
  const valid =
    action === "delete" ? name === project.name : !!name.trim() && name.trim().length <= 200;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "rename" ? t`Rename project` : t`Delete project`}</DialogTitle>
          {action === "delete" ? (
            <DialogDescription>
              <Trans>
                Deleting this project also deletes its work packages and documents. Its project
                manager is archived; chat history is kept.
              </Trans>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || pending.current) return;
            pending.current = true;
            setBusy(true);
            setError(false);
            try {
              const response = await fetch(
                `/api/agent-plane/projects/${encodeURIComponent(project.id)}`,
                {
                  method: action === "rename" ? "PATCH" : "DELETE",
                  credentials: "include",
                  headers: withSpaceHeaders(
                    {
                      "Content-Type": "application/json",
                      ...(bindingRevision
                        ? { "x-rakazo-binding-revision": String(bindingRevision) }
                        : {}),
                    },
                    spaceId,
                  ),
                  body: JSON.stringify({ name: action === "rename" ? name.trim() : name }),
                },
              );
              if (!response.ok) throw new Error("Project mutation failed");
              await Promise.all([
                queries.invalidateQueries({ queryKey: ["hierarchy"] }),
                queries.invalidateQueries({ queryKey: ["client-navigation"] }),
                queries.invalidateQueries({ queryKey: ["project-commercial"] }),
              ]);
              onClose();
            } catch {
              setError(true);
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <label htmlFor={id}>
            {action === "rename" ? t`Project name` : t`Type ${project.name} to confirm`}
          </label>
          <Input
            id={id}
            value={name}
            maxLength={action === "rename" ? 200 : 500}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          {error ? (
            <p role="alert" className="text-body text-destructive">
              {action === "rename"
                ? t`Could not rename project. Try again.`
                : t`Could not delete project. Try again.`}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              variant={action === "delete" ? "destructive" : "default"}
              disabled={!valid || busy}
            >
              {action === "rename" ? t`Save` : t`Delete project`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
