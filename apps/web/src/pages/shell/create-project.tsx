import { Trans, useLingui } from "@lingui/react/macro";
import type { CreatedProject } from "@rakazo/contracts/hierarchy";
import { CreatedProjectSchema } from "@rakazo/contracts/hierarchy";
import { Button, Input } from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { clientSetupDebug, clientSetupFetch } from "../../lib/client-setup-debug";
import { withSpaceHeaders } from "../../lib/rpc";

export function CreateProject({
  buildingId,
  spaceId,
  refresh,
  bindingRevision,
  initiallyOpen = false,
  onCreated,
  onBusyChange,
  existingProjects = [],
}: {
  buildingId: string;
  spaceId: string | null;
  refresh: () => void;
  bindingRevision?: number;
  initiallyOpen?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCreated?: (project: Pick<CreatedProject, "id" | "name" | "botId">) => Promise<void>;
  existingProjects?: Pick<CreatedProject, "id" | "name" | "botId">[];
}) {
  const { t } = useLingui();
  const id = useId();
  const operationId = useRef(crypto.randomUUID());
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const createdProject = useRef<Pick<CreatedProject, "id" | "name" | "botId"> | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  function close() {
    operationId.current = crypto.randomUUID();
    setOpen(false);
    setName("");
    setError("");
    trigger.current?.focus();
  }
  return (
    <>
      {!initiallyOpen ? (
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-expanded={open}
        >
          <Trans>Add project</Trans>
        </Button>
      ) : null}
      {open ? (
        <form
          className="flex min-w-0 flex-col gap-2 py-2"
          aria-label={t`Add project`}
          aria-busy={loading}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim() || !spaceId || pending.current) return;
            pending.current = true;
            setLoading(true);
            onBusyChange?.(true);
            setError("");
            try {
              createdProject.current ??= onCreated
                ? (existingProjects.find((project) => project.name === name.trim()) ?? null)
                : null;
              if (!createdProject.current) {
                const response = await clientSetupFetch(
                  "add_project",
                  "/api/agent-plane/projects",
                  {
                    method: "POST",
                    credentials: "include",
                    headers: withSpaceHeaders(
                      {
                        "Content-Type": "application/json",
                        "Idempotency-Key": operationId.current,
                        ...(bindingRevision
                          ? { "x-rakazo-binding-revision": String(bindingRevision) }
                          : {}),
                      },
                      spaceId,
                    ),
                    body: JSON.stringify({ buildingId, name: name.trim() }),
                  },
                );
                if (response.status === 409) {
                  setError(t`Project already exists`);
                  return;
                }
                if (!response.ok) throw new Error("Creation failed");
                const created = CreatedProjectSchema.parse(await response.json());
                clientSetupDebug("add_project", {
                  projectId: created.id,
                  spaceId,
                  requestId: response.headers.get("x-request-id"),
                  httpStatus: response.status,
                  status: "parsed",
                });
                createdProject.current = created;
                refresh();
              }
              await onCreated?.(createdProject.current);
              createdProject.current = null;
              close();
            } catch {
              setError(t`Could not complete project setup. Try again.`);
            } finally {
              pending.current = false;
              setLoading(false);
              onBusyChange?.(false);
            }
          }}
        >
          <label htmlFor={id}>
            <Trans>Project name</Trans>
          </label>
          <Input
            id={id}
            autoFocus
            required
            maxLength={200}
            value={name}
            disabled={loading || !!createdProject.current}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-body text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !spaceId}>
              {loading ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
            </Button>
            {!initiallyOpen ? (
              <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={close}>
                <Trans>Cancel</Trans>
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </>
  );
}
