import { Trans, useLingui } from "@lingui/react/macro";
import type {
  CreatedBuilding,
  LocationCandidates,
  LocationProof,
} from "@rakazo/contracts/hierarchy";
import {
  CreatedBuildingSchema,
  LocationCandidatesSchema,
  LocationProofSchema,
} from "@rakazo/contracts/hierarchy";
import { Button, Input } from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { clientSetupDebug, clientSetupFetch } from "../../lib/client-setup-debug";
import { withSpaceHeaders } from "../../lib/rpc";

export function CreateBuilding({
  spaceId,
  refresh,
  bindingRevision,
  initiallyOpen = false,
  onCreated,
  onBusyChange,
}: {
  spaceId: string | null;
  refresh: () => void;
  bindingRevision?: number;
  initiallyOpen?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCreated?: (building: CreatedBuilding) => void | Promise<void>;
}) {
  const { t } = useLingui();
  const id = useId();
  const operationId = useRef(crypto.randomUUID());
  const trigger = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState("");
  const [nickname, setNickname] = useState("");
  const [candidates, setCandidates] = useState<LocationCandidates | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [proof, setProof] = useState<LocationProof | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Retain the exact confirmed payload after a lost response, including its proof.
  const confirmed = useRef<{
    address: string;
    verification_token: string;
    nickname: string;
  } | null>(null);
  async function post(path: string, data: unknown) {
    const response = await clientSetupFetch(
      path === "buildings" ? "add_building" : "location",
      `/api/agent-plane/${path}`,
      {
        method: "POST",
        credentials: "include",
        headers: withSpaceHeaders(
          {
            "Content-Type": "application/json",
            "Idempotency-Key": operationId.current,
            ...(bindingRevision ? { "x-rakazo-binding-revision": String(bindingRevision) } : {}),
          },
          spaceId,
        ),
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Request unavailable");
    const result: unknown = await response.json();
    if (path === "buildings") {
      const building = CreatedBuildingSchema.parse(result);
      clientSetupDebug("add_building", {
        buildingId: building.id,
        spaceId,
        requestId: response.headers.get("x-request-id"),
        httpStatus: response.status,
        status: "parsed",
      });
    }
    return result;
  }
  function close() {
    operationId.current = crypto.randomUUID();
    setOpen(false);
    setQuery("");
    setNickname("");
    setCandidates(null);
    setChoice(null);
    setProof(null);
    setError("");
    confirmed.current = null;
    trigger.current?.focus();
  }
  return (
    <>
      {!initiallyOpen ? (
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          disabled={!spaceId}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Trans>Add building</Trans>
        </Button>
      ) : null}
      {open ? (
        <form
          className="flex min-w-0 flex-col gap-2 py-2"
          aria-label={t`Add building`}
          aria-busy={pending}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy.current || !spaceId) return;
            busy.current = true;
            setPending(true);
            onBusyChange?.(true);
            setError("");
            try {
              if (proof) {
                confirmed.current ??= {
                  address: proof.address,
                  verification_token: proof.verification_token,
                  nickname: nickname.trim(),
                };
                const building = CreatedBuildingSchema.parse(
                  await post("buildings", confirmed.current),
                );
                refresh();
                await onCreated?.(building);
                close();
              } else if (candidates && choice !== null) {
                const candidate = candidates.items[choice];
                if (!candidate?.selectable) return;
                setProof(
                  LocationProofSchema.parse(
                    await post("locations/proof", {
                      verification_token: candidate.verification_token,
                    }),
                  ),
                );
              } else {
                setCandidates(
                  LocationCandidatesSchema.parse(
                    await post("locations/search", { query: query.trim() }),
                  ),
                );
                setChoice(null);
              }
            } catch {
              setError(t`Could not complete building setup. Try again.`);
            } finally {
              busy.current = false;
              setPending(false);
              onBusyChange?.(false);
            }
          }}
        >
          {proof ? (
            <>
              <p className="text-body break-words">{proof.address}</p>
              <p className="text-body text-muted-foreground break-words">{proof.attribution}</p>
              <label htmlFor={`${id}-nickname`}>
                <Trans>Nickname (optional)</Trans>
              </label>
              <Input
                id={`${id}-nickname`}
                maxLength={200}
                value={nickname}
                disabled={pending || !!confirmed.current}
                onChange={(event) => setNickname(event.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor={`${id}-query`}>
                <Trans>Address or site</Trans>
              </label>
              <Input
                id={`${id}-query`}
                autoFocus
                required
                minLength={3}
                maxLength={300}
                value={query}
                disabled={pending}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCandidates(null);
                  setChoice(null);
                  setError("");
                }}
              />
              {candidates ? (
                <fieldset disabled={pending} className="flex flex-col gap-2">
                  <legend className="sr-only">
                    <Trans>Choose a location</Trans>
                  </legend>
                  {candidates.items.length === 0 ? (
                    <p role="status">
                      <Trans>No locations found</Trans>
                    </p>
                  ) : null}
                  {candidates.items.map((candidate, index) => (
                    <label
                      key={`${candidate.address}:${index}`}
                      className="flex min-h-10 items-center gap-2 text-body break-words"
                    >
                      <input
                        type="radio"
                        name={`${id}-choice`}
                        checked={choice === index}
                        disabled={!candidate.selectable}
                        onChange={() => setChoice(index)}
                      />
                      {candidate.address}
                    </label>
                  ))}
                  <p className="text-body text-muted-foreground break-words">
                    {candidates.attribution}
                  </p>
                </fieldset>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-body text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                pending ||
                !spaceId ||
                (!proof && query.trim().length < 3) ||
                (!!candidates && choice === null)
              }
            >
              {pending
                ? t`Working…`
                : proof
                  ? t`Confirm building`
                  : candidates
                    ? t`Use location`
                    : t`Search`}
            </Button>
            {!initiallyOpen ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={close}>
                <Trans>Cancel</Trans>
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </>
  );
}
