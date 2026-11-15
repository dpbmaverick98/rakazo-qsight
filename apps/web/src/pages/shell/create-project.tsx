import { Trans, useLingui } from "@lingui/react/macro";
import { CreatedProjectSchema } from "@rakazo/contracts/hierarchy";
import { Button, Input } from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";

export function CreateProject({
  buildingId,
  spaceId,
  refresh,
}: {
  buildingId: string;
  spaceId: string | null;
  refresh: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  function close() {
    setOpen(false);
    setName("");
    setError("");
    trigger.current?.focus();
  }
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-expanded={open}
      >
        <Trans>Add project</Trans>
      </Button>
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
            setError("");
            try {
              const response = await fetch("/api/agent-plane/projects", {
                method: "POST",
                credentials: "include",
                headers: withSpaceHeaders({ "Content-Type": "application/json" }, spaceId),
                body: JSON.stringify({ buildingId, name: name.trim() }),
              });
              if (response.status === 409) {
                setError(t`Project already exists`);
                return;
              }
              if (!response.ok) throw new Error("Creation failed");
              CreatedProjectSchema.parse(await response.json());
              refresh();
              close();
            } catch {
              setError(t`Could not create project. Try again.`);
            } finally {
              pending.current = false;
              setLoading(false);
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
            maxLength={500}
            value={name}
            disabled={loading}
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
            <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
