import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { selectSpace } from "../../lib/rpc";
import { AddClientDialog } from "./add-client-dialog";

/** Post-login entry: one action, no default Personal chat, no empty shell. */
export function ClientLanding() {
  const [open, setOpen] = useState(false);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-xl">
        <p className="text-body-sm font-medium tracking-wide text-muted-foreground">
          VENDOR ONE MANAGEMENT
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          <Trans>Start with a client</Trans>
        </h1>
        <p className="mt-4 max-w-lg text-body leading-6 text-muted-foreground">
          <Trans>
            Each client gets its own Space with buildings, projects and a project manager. Add
            your first client, then tell its PM the building and project details.
          </Trans>
        </p>
        <Button className="mt-8" onClick={() => setOpen(true)}>
          <Trans>Create client</Trans>
        </Button>
        {open ? (
          <AddClientDialog
            onCancel={() => setOpen(false)}
            onDone={(result) => {
              selectSpace(result.spaceId);
              window.location.assign(`/app/${encodeURIComponent(result.botId)}`);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
