import { t } from "@lingui/core/macro";
import type { Space } from "@rakazo/contracts";
import type { ClientNavigation } from "@rakazo/contracts/hierarchy";
import { ClientNavigationSchema } from "@rakazo/contracts/hierarchy";
import { useQueries } from "@tanstack/react-query";
import { withSpaceHeaders } from "../../lib/rpc";
import type { sidebarGroupsForSpaces } from "./space-sidebar";

type Groups = ReturnType<
  typeof sidebarGroupsForSpaces<Space["bots"][number], Space["groups"][number]>
>;
type BotItem = Extract<Groups[number]["bots"][number], { kind: "bot" }>;

export type NavigationGroup = Groups[number] & {
  buildingId?: string;
  project?: { id: string; name: string };
  ancestors?: string[];
  depth?: number;
  defaultCollapsed?: boolean;
  forceOpen?: boolean;
  unavailable?: boolean;
  retryNavigation?: () => void;
};

export function useClientNavigations(userId: string | null, spaceIds: string[]) {
  return useQueries({
    queries: spaceIds.map((spaceId) => ({
      queryKey: ["client-navigation", userId, spaceId],
      enabled: !!userId && !!spaceId,
      retry: false,
      refetchOnWindowFocus: true,
      queryFn: async ({ signal }) => {
        const response = await fetch("/api/agent-plane/navigation", {
          headers: withSpaceHeaders(undefined, spaceId),
          credentials: "include",
          signal,
        });
        if (response.status === 204) return null;
        if (!response.ok) {
          const body = await response.json();
          if (response.status === 409 && ["personal", "binding_missing"].includes(body.status))
            return null;
          throw new Error("Navigation unavailable");
        }
        const navigation = ClientNavigationSchema.parse(await response.json());
        if (navigation.spaceId !== spaceId) throw new Error("Navigation scope changed");
        return navigation;
      },
    })),
  });
}

/** Assignment comes from the server; roster data supplies activity and existing actions. */
export function clientNavigationGroups(
  groups: Groups,
  navigation: ClientNavigation | null | undefined,
  query: string,
  rosterGroups: Groups = groups,
): NavigationGroup[] {
  if (!navigation) return groups;
  const own = rosterGroups.filter((group) => group.spaceId === navigation.spaceId);
  const template = own[0];
  if (!template) return groups;
  const items = own.flatMap((group) => group.bots);
  const assigned = new Set([
    ...navigation.setupBotIds,
    ...navigation.buildings.flatMap((building) => [
      ...building.projects.flatMap((project) => project.botIds),
    ]),
  ]);
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const prefix = `client:${navigation.spaceId}:${navigation.bindingRevision}`;
  const root = `${prefix}:root`;
  const result: NavigationGroup[] = [];
  const make = (
    key: string,
    title: string,
    ancestors: string[],
    bots: typeof items,
  ): NavigationGroup => ({
    ...template,
    key,
    title,
    subtitle: undefined,
    sectionId: null,
    emptySpaceId: undefined,
    canOpenSpaceSettings: key === root,
    canRenameSpace: key === root && template.canRenameSpace,
    canDeleteSpace: key === root && template.canDeleteSpace,
    showLock: key === root,
    bots,
    ancestors,
    depth: ancestors.length,
    forceOpen: !!needle,
  });
  const rootMatch = matches(navigation.client.name);
  const selected = (ids: string[], ancestorMatch: boolean) =>
    items.filter(
      (item): item is BotItem =>
        item.kind === "bot" &&
        ids.includes(item.chat.id) &&
        (!needle || ancestorMatch || matches(item.chat.name) || matches(item.chat.preview ?? "")),
    );
  result.push(
    make(
      root,
      navigation.client.name,
      [],
      selected(navigation.setupBotIds, rootMatch || matches("Proj. Manager - Sam")).map((item) => ({
        ...item,
        chat: { ...item.chat, name: "Proj. Manager - Sam" },
      })),
    ),
  );
  for (const building of navigation.buildings) {
    const key = `${prefix}:building:${building.id}`;
    const buildingMatch = rootMatch || matches(building.name);
    const bots = building.projects.flatMap((project) => {
      const botId = project.botIds[0];
      if (!botId || !resolveProjectManager(navigation, botId)) return [];
      return selected([botId], buildingMatch || matches(`${project.name} - PM`)).map((item) => ({
        ...item,
        chat: { ...item.chat, name: `${project.name} - PM` },
      }));
    });
    if (!needle || buildingMatch || bots.length)
      result.push({
        ...make(key, building.name, [root], bots),
        buildingId: building.id,
        canOpenSpaceSettings: false,
      });
  }
  const unassigned = items
    .filter((item) => item.kind !== "bot" || !assigned.has(item.chat.id))
    .filter(
      (item) => !needle || rootMatch || matches(item.chat.name) || matches(item.chat.preview ?? ""),
    );
  const remaining = new Set(unassigned.map((item) => `${item.kind}:${item.chat.id}`));
  for (const group of own) {
    const bots = group.bots.filter((item) => remaining.has(`${item.kind}:${item.chat.id}`));
    if (!bots.length && !group.sectionId) continue;
    result.push({
      ...make(
        `${prefix}:unassigned:${group.key}`,
        group.sectionId
          ? (group.subtitle ?? group.title ?? t`Unassigned`)
          : group.key.endsWith("pinned")
            ? t`Pinned`
            : t`Unassigned`,
        [root],
        bots,
      ),
      sectionId: group.sectionId,
      defaultCollapsed: !group.sectionId,
    });
  }
  if (needle && result.length === 1 && !result[0]?.bots.length && !rootMatch)
    return groups.filter((group) => group.spaceId !== navigation.spaceId);
  const index = groups.findIndex((group) => group.spaceId === navigation.spaceId);
  const first = Math.max(index, 0);
  return [
    ...groups.slice(0, first),
    ...result,
    ...groups.slice(first).filter((group) => group.spaceId !== navigation.spaceId),
  ];
}

/** Resolve routes and sidebar clicks through the same explicit assignment. */
export function resolveProjectManager(
  navigation: ClientNavigation | null | undefined,
  botId: string | undefined,
) {
  if (!navigation || !botId) return null;
  const matches = navigation.buildings.flatMap((building) =>
    building.projects
      .filter((project) => project.botIds.includes(botId))
      .map((project) => ({ building, project })),
  );
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  if (
    match.project.botIds.length !== 1 ||
    navigation.setupBotIds.includes(botId) ||
    navigation.buildings.some((building) => building.botIds?.includes(botId)) ||
    navigation.buildings.filter((building) => building.id === match.building.id).length !== 1 ||
    navigation.buildings
      .flatMap((building) => building.projects)
      .filter((project) => project.id === match.project.id).length !== 1
  )
    return null;
  return {
    spaceId: navigation.spaceId,
    bindingRevision: navigation.bindingRevision,
    clientId: navigation.client.id,
    buildingId: match.building.id,
    projectId: match.project.id,
    botId,
  };
}

export function unavailableClientNavigation(
  groups: Groups,
  spaceId: string,
  retryNavigation?: () => void,
): NavigationGroup[] {
  const template = groups.find((group) => group.spaceId === spaceId);
  if (!template) return groups;
  const index = groups.indexOf(template);
  return [
    ...groups.slice(0, index),
    {
      ...template,
      key: `client:${spaceId}:unavailable`,
      emptySpaceId: undefined,
      sectionId: null,
      title: template.spaceName,
      subtitle: undefined,
      bots: [],
      unavailable: true,
      retryNavigation,
    },
    ...groups.slice(index + 1).filter((group) => group.spaceId !== spaceId),
  ];
}
