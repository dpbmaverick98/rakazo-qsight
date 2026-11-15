import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { Button } from "@rakazo/ui-web";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpcForSpace } from "../../lib/rpc";
export function ProjectManagerAction({
  project,
  client,
  spaceId,
  onOpenBot,
}: {
  project: ProjectCommercial["project"];
  client: string;
  spaceId: string;
  onOpenBot?: (bot: Bot) => void;
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
        projectName: project.name,
        clientName: client,
      });
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
        {pending ? t`Creating…` : t`Create project manager`}
      </Button>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
