import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";
import { CreateBuilding } from "./create-building";
import { CreateProject } from "./create-project";
import { hierarchyRetry } from "./hierarchy-refresh";
import { CommercialSelection, ProjectActivity } from "./project-commercial";
import { ProjectManagerAction } from "./project-manager";

const BuildingMap = lazy(() => import("./building-map"));

export function useHierarchy(userId: string | null, spaceId: string | null, enabled: boolean) {
  return useQuery<Hierarchy | null>({
    queryKey: ["hierarchy", userId, spaceId],
    enabled: enabled && !!userId && !!spaceId,
    retry: hierarchyRetry,
    refetchOnWindowFocus: true,
    // Recovery fallback only until real data arrives; React Query owns timer cleanup.
    refetchInterval: (query) =>
      (
        query.state.error
          ? hierarchyRetry(0, query.state.error)
          : !query.state.data?.buildings.length
      )
        ? 5_000
        : false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agent-plane/hierarchy", {
        headers: withSpaceHeaders(undefined, spaceId),
        credentials: "include",
        signal,
      });
      if (response.status === 204) return null;
      if (!response.ok) {
        if (response.status === 409) {
          const body = await response.json();
          if (["personal", "binding_missing"].includes(body.status)) return null;
        }
        throw Object.assign(new Error("Hierarchy unavailable"), { status: response.status });
      }
      return HierarchySchema.parse(await response.json());
    },
  });
}

export function HierarchyRail({
  data,
  loading,
  error,
  retry,
  collapse,
  scope,
  onOpenBot,
}: {
  onOpenBot?: (bot: Bot) => void;
  scope?: { userId: string | null; spaceId: string | null };
  data?: Hierarchy | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  collapse: () => void;
}) {
  const { t } = useLingui();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const rows = useRef(new Map<string, HTMLLIElement>());
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedProject = data?.buildings
    .flatMap((building) => building.projects)
    .find((project) => project.id === selected);
  function selectBuilding(id: string) {
    setClosed((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    const row = rows.current.get(id);
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector("button")?.focus({ preventScroll: true });
  }
  return (
    <section
      aria-label={t`Client hierarchy`}
      className="@container rk-scroll min-h-0 overflow-y-auto px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionHeading className="min-w-0 break-words">
          <Trans>Workspace artifacts</Trans>
        </SectionHeading>
        <Button variant="ghost" size="sm" onClick={collapse} aria-label={t`Collapse hierarchy`}>
          <Trans>Hide</Trans>
        </Button>
      </div>
      {data?.buildings.length ? (
        <p className="mb-3 text-body font-medium break-words">{data.client.name}</p>
      ) : null}
      {!data?.buildings.length ? (
        <p className="text-body text-muted-foreground">
          <Trans>Quick access to building and project details</Trans>
        </p>
      ) : null}
      {data ? (
        <CreateBuilding
          key={`${scope?.userId}:${scope?.spaceId}:${data.bindingRevision}`}
          spaceId={scope?.spaceId ?? null}
          bindingRevision={data.bindingRevision}
          refresh={retry}
        />
      ) : null}
      {loading && !data?.buildings.length ? (
        <p role="status" className="text-body text-muted-foreground">
          <Trans>Loading hierarchy…</Trans>
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p className="text-body text-muted-foreground">
            <Trans>Hierarchy unavailable</Trans>
          </p>
          <Button variant="ghost" size="sm" onClick={retry}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {data &&
      scope?.spaceId &&
      data.buildings.flatMap((building) => building.projects).length === 1 ? (
        <ProjectManagerAction
          key={`${scope.spaceId}:${data.client.id}`}
          project={data.buildings.flatMap((building) => building.projects)[0]!}
          client={data.client.name}
          spaceId={scope.spaceId}
          onOpenBot={onOpenBot}
          bindingRevision={data.bindingRevision}
          finishSetup
          onChanged={retry}
        />
      ) : null}
      {data ? (
        <nav
          aria-label={t`Buildings and projects`}
          className={selectedProject ? "max-h-48 overflow-y-auto" : undefined}
        >
          {data.buildings.some(
            (building) => building.latitude != null && building.longitude != null,
          ) ? (
            <div className="mb-3 h-40 overflow-hidden rounded-md border border-border @min-[300px]:h-48">
              <Suspense fallback={null}>
                <BuildingMap buildings={data.buildings} onSelect={selectBuilding} />
              </Suspense>
            </div>
          ) : null}
          {data.buildings.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.buildings.map((building) => (
                <li
                  key={building.id}
                  ref={(row) => {
                    if (row) rows.current.set(building.id, row);
                    else rows.current.delete(building.id);
                  }}
                >
                  <Disclosure
                    open={!closed.has(building.id)}
                    onOpenChange={(expanded) =>
                      setClosed((previous) => {
                        const next = new Set(previous);
                        if (expanded) next.delete(building.id);
                        else next.add(building.id);
                        return next;
                      })
                    }
                    summary={building.name}
                    summaryClassName="min-h-10 w-full justify-between break-words text-body"
                  >
                    {building.address ? (
                      <p className="ps-4 text-body text-muted-foreground break-words">
                        {building.address}
                      </p>
                    ) : null}
                    {!closed.has(building.id) ? (
                      <CreateProject
                        buildingId={building.id}
                        spaceId={scope?.spaceId ?? null}
                        bindingRevision={data.bindingRevision}
                        refresh={retry}
                      />
                    ) : null}
                    {building.projects.length === 0 ? (
                      <p className="ps-4 text-body text-muted-foreground">
                        <Trans>No projects</Trans>
                      </p>
                    ) : (
                      <ul className="border-s border-border ps-4">
                        {building.projects.map((project) => (
                          <li key={project.id}>
                            <Button
                              variant="ghost"
                              className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-start break-words"
                              aria-pressed={selected === project.id}
                              onClick={(event) => {
                                selectionTrigger.current = event.currentTarget;
                                setSelected(project.id);
                              }}
                            >
                              {project.name}
                            </Button>
                            {scope?.userId && scope.spaceId ? (
                              <ProjectActivity
                                userId={scope.userId}
                                spaceId={scope.spaceId}
                                projectId={project.id}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Disclosure>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>
      ) : null}
      {selectedProject && scope ? (
        <CommercialSelection
          key={selectedProject.id}
          {...scope}
          onOpenBot={onOpenBot}
          projectId={selectedProject.id}
          client={data!.client.name}
          back={() => {
            setSelected(null);
            selectionTrigger.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
