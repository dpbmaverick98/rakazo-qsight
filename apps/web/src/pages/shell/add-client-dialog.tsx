import { Trans, useLingui } from "@lingui/react/macro";
import type { ClientSetup } from "@rakazo/contracts/hierarchy";
import { ClientSetupSchema } from "@rakazo/contracts/hierarchy";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";

export function AddClientDialog({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (result: ClientSetup) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ClientSetup | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <form
          className="flex flex-col gap-4"
          aria-busy={saving}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim() || pending.current) return;
            pending.current = true;
            setSaving(true);
            setError("");
            try {
              const response = await fetch("/api/agent-plane/clients", {
                method: "POST",
                credentials: "include",
                headers: withSpaceHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ name: name.trim() }),
              });
              if (response.status === 409) {
                const failure = await response.json();
                setError(
                  failure.status === "setup_archived"
                    ? t`Restore the PM from Archived chats to continue setup.`
                    : t`Client setup conflicts with an existing binding.`,
                );
                return;
              }
              if (!response.ok) throw new Error("Setup unavailable");
              const setup = ClientSetupSchema.parse(await response.json());
              setResult(setup);
              if (setup.status === "ready") onDone(setup);
            } catch {
              setError(t`Could not finish client setup. Try again.`);
            } finally {
              pending.current = false;
              setSaving(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <Trans>Add client</Trans>
            </DialogTitle>
          </DialogHeader>
          <label htmlFor={id}>
            <Trans>Client name</Trans>
          </label>
          <Input
            id={id}
            autoFocus
            required
            maxLength={60}
            value={name}
            disabled={saving || !!result}
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
          {result?.status === "mcp_missing" ? (
            <p role="status" className="text-body text-muted-foreground">
              <Trans>
                PM saved. Connect your setup tools in Settings, then retry Add client with this
                name.
              </Trans>
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            {result ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onDone(result)}
              >
                <Trans>Open PM</Trans>
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? (
                <Trans>Setting up…</Trans>
              ) : result || error ? (
                <Trans>Retry</Trans>
              ) : (
                <Trans>Add client</Trans>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
