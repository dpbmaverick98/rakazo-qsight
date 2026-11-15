import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { Button } from "@rakazo/ui-web";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpcForSpace } from "../../lib/rpc";
import { projectManagerInstructions } from "./project-manager.prompt";

/** Creation commits before attachment. Keep the bot on failure; retry never recreates it. */
const PROJECT_MANAGER_SERVER = "QSight PM Pilot";
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
  const [createdBot, setCreatedBot] = useState<Bot | null>(null);
  const botId = createdBot?.id;
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
    let bot = createdBot;
    try {
      if (!bot) {
        const name = `PM — ${project.name}`.slice(0, 80);
        const spawnKey = `pm:${project.id}`;
        const bots = await rpc.bots.list();
        const existing = bots.find(
          (item) => !item.archivedAt && (item.name === name || item.spawnKey === spawnKey),
        );
        if (existing) {
          if (mounted.current) open(existing);
          return;
        }
        try {
          bot = await rpc.bots.create({
            name,
            spawnKey,
            instructions: projectManagerInstructions(project, client),
            dailyCheckIns: false,
            fleetManagement: false,
          });
        } catch (reason) {
          // Another panel/tab won the unique (spaceId, spawnKey) create race.
          const after = await rpc.bots.list();
          const winner = after.find(
            (item) => !item.archivedAt && (item.spawnKey === spawnKey || item.name === name),
          );
          if (!winner) throw reason;
          bot = winner;
        }
        if (mounted.current) setCreatedBot(bot);
      }
      const servers = await rpc.mcp.servers.list();
      const server = servers.find((item) => item.name === PROJECT_MANAGER_SERVER);
      if (!server?.enabled) throw new Error("Server unavailable");
      const assignments = await rpc.mcp.assignments.list({ botId: bot.id });
      if (!assignments.some((item) => item.serverId === server.id)) {
        // Only this bot's assignments are replaced. Other bots and allBots are untouched.
        await rpc.mcp.assignments.replace({
          botId: bot.id,
          assignments: [
            ...assignments.map(({ serverId, allowAllTools, allowedTools }) => ({
              serverId,
              allowAllTools,
              allowedTools,
            })),
            { serverId: server.id, allowAllTools: true, allowedTools: [] },
          ],
        });
      }
      if (mounted.current) open(bot);
    } catch {
      if (mounted.current)
        setError(
          bot
            ? t`Project manager created, but the tool connection is unconfigured. Check the ${PROJECT_MANAGER_SERVER} MCP server and retry.`
            : t`Could not create project manager. Retry to check whether it was created.`,
        );
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
        {pending ? t`Creating…` : botId ? t`Retry connection` : t`Create project manager`}
      </Button>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      {botId && error ? (
        <Button variant="ghost" size="sm" onClick={() => createdBot && open(createdBot)}>
          <Trans>Open project manager</Trans>
        </Button>
      ) : null}
    </div>
  );
}
