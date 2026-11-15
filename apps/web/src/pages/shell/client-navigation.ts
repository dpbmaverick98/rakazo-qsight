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
export type NavigationGroup = Groups[number] & {
  buildingId?: string;
  ancestors?: string[];
  depth?: number;
  defaultCollapsed?: boolean;
  forceOpen?: boolean;
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
      ...(building.botIds ?? []),
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
      (item) =>
        item.kind === "bot" &&
        ids.includes(item.chat.id) &&
        (!needle || ancestorMatch || matches(item.chat.name) || matches(item.chat.preview ?? "")),
    );
  result.push(make(root, navigation.client.name, [], selected(navigation.setupBotIds, rootMatch)));
  for (const building of navigation.buildings) {
    const key = `${prefix}:building:${building.id}`;
    const buildingMatch = rootMatch || matches(building.name);
    const visibleIds = new Set([
      ...selected(building.botIds ?? [], buildingMatch).map((item) => item.chat.id),
      ...building.projects.flatMap((project) =>
        selected(project.botIds, buildingMatch || matches(project.name)).map(
          (item) => item.chat.id,
        ),
      ),
    ]);
    const bots = items.filter((item) => item.kind === "bot" && visibleIds.has(item.chat.id));
    if (
      !needle ||
      buildingMatch ||
      bots.length ||
      building.projects.some((project) => matches(project.name))
    )
      result.push({
        ...make(key, building.name, [root], bots),
        buildingId: building.id,
        canOpenSpaceSettings: true,
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
