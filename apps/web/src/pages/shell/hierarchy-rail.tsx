import { Trans, useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { Button, Disclosure, SectionHeading, Tabs, TabsList, TabsTrigger } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Building } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { withSpaceHeaders } from "../../lib/rpc";
import { CommercialInspection, inspectionStorageKey } from "./commercial-inspection";
import { hierarchyRetry } from "./hierarchy-refresh";
import { useProjectCommercial } from "./project-commercial";

const BuildingMap = lazy(() => import("./building-map"));

function MapFallback() {
  const { t } = useLingui();
  return (
    <p
      role="status"
      className="mb-4 flex h-40 items-center justify-center rounded-md border border-border bg-muted text-body text-muted-foreground"
    >{t`Map unavailable`}</p>
  );
}

export function useHierarchy(userId: string | null, spaceId: string | null, enabled: boolean) {
  return useQuery<Hierarchy | null>({
    queryKey: ["hierarchy", userId, spaceId],
    enabled: enabled && !!userId && !!spaceId,
    retry: hierarchyRetry,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agent-plane/hierarchy", {
        headers: withSpaceHeaders(undefined, spaceId),
        credentials: "include",
        signal,
      });
      // Binding transitions and unconfigured Spaces have no authorized hierarchy yet.
      if (response.status === 204 || response.status === 409) return null;
      if (!response.ok) {
        throw Object.assign(new Error("Hierarchy unavailable"), { status: response.status });
      }
      return HierarchySchema.parse(await response.json());
    },
  });
}

export type ProjectSelection = {
  botId: string;
  revision: number;
  buildingId: string;
  projectId: string;
};

export function ProjectStage({
  data,
  loading,
  error,
  retry,
  scope,
  selection,
  tab,
  onTabChange,
}: {
  data?: Hierarchy | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  scope: { userId: string | null; spaceId: string | null };
  selection: ProjectSelection;
  tab: "space" | "claims";
  onTabChange: (tab: "space" | "claims") => void;
}) {
  const { t } = useLingui();
  const building =
    data?.bindingRevision === selection.revision
      ? data.buildings.find(
          (item) =>
            item.id === selection.buildingId &&
            item.projects.some((project) => project.id === selection.projectId),
        )
      : undefined;
  const inspectionScope = JSON.stringify([
    scope.userId,
    scope.spaceId,
    selection.botId,
    selection.revision,
    selection.projectId,
  ]);
  useEffect(() => {
    if (error || (!loading && !building))
      sessionStorage.removeItem(inspectionStorageKey(inspectionScope));
  }, [error, loading, building, inspectionScope]);
  if (building && !error)
    return (
      <ProjectStageContent
        data={data!}
        building={building}
        scope={scope}
        selection={selection}
        tab={tab}
        onTabChange={onTabChange}
      />
    );
  return (
    <Tabs value={tab} onValueChange={(value) => onTabChange(value as "space" | "claims")}>
      <TabsList aria-label={t`Project views`} variant="line">
        <TabsTrigger value="space">
          <Trans>Project space</Trans>
        </TabsTrigger>
        <TabsTrigger value="claims">
          <Trans>Claims</Trans>
        </TabsTrigger>
      </TabsList>
      {error ? (
        <div role="alert">
          <Trans>Project space unavailable</Trans>
          <Button variant="ghost" onClick={retry}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : (
        <p role="status">{loading ? t`Loading project space…` : t`Project unavailable`}</p>
      )}
    </Tabs>
  );
}

function ProjectStageContent({
  data,
  building,
  scope,
  selection,
  tab,
  onTabChange,
}: {
  data: Hierarchy;
  building: Hierarchy["buildings"][number];
  scope: { userId: string | null; spaceId: string | null };
  selection: ProjectSelection;
  tab: "space" | "claims";
  onTabChange: (tab: "space" | "claims") => void;
}) {
  const query = useProjectCommercial(
    scope.userId,
    scope.spaceId,
    selection.projectId,
    selection.revision,
    selection.botId,
  );
  const commercial = query.isError ? undefined : (query.data ?? undefined);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([selection.projectId]));
  const projectSpace = (
    <>
      <SectionHeading variant="label" className="mt-4">
        <Trans>Project space</Trans>
      </SectionHeading>
      <h2 className="my-4 text-heading1 font-semibold tracking-tight break-words">
        {data.client.name}
      </h2>
      <ErrorBoundary fallback={<MapFallback />} key={building.id}>
        <Suspense fallback={<MapFallback />}>
          <BuildingMap building={building} />
        </Suspense>
      </ErrorBoundary>
      <div className="mb-3 flex items-center gap-2">
        <Building aria-hidden="true" className="size-4 shrink-0" />
        <span>{building.name}</span>
      </div>
      {building.address?.trim() &&
      building.address.trim().toLocaleLowerCase() !== building.name.trim().toLocaleLowerCase() ? (
        <p className="mb-3 text-body text-muted-foreground">{building.address}</p>
      ) : null}
      <ul>
        {building.projects.map((project) => (
          <li key={project.id}>
            <Disclosure
              open={expanded.has(project.id)}
              onOpenChange={(open) =>
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (open) next.add(project.id);
                  else next.delete(project.id);
                  return next;
                })
              }
              summary={project.name}
              summaryClassName="min-h-10 w-full justify-between text-start text-body"
            >
              {project.id === selection.projectId ? (
                <>
                  <CommercialStatus
                    loading={query.isPending}
                    unavailable={!query.data}
                    error={query.isError}
                    retry={() => {
                      void query.refetch();
                    }}
                  />
                  {commercial ? (
                    <ClaimLinks data={commercial} onClaims={() => onTabChange("claims")} />
                  ) : null}
                </>
              ) : expanded.has(project.id) ? (
                <ProjectPreview scope={scope} selection={selection} projectId={project.id} />
              ) : null}
            </Disclosure>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <CommercialInspection
      previewContext={{
        botId: selection.botId,
        projectId: selection.projectId,
        revision: selection.revision,
      }}
      key={JSON.stringify([
        scope.userId,
        scope.spaceId,
        selection.botId,
        selection.revision,
        selection.projectId,
      ])}
      scope={JSON.stringify([
        scope.userId,
        scope.spaceId,
        selection.botId,
        selection.revision,
        selection.projectId,
      ])}
      ready={query.isFetchedAfterMount && !query.isFetching}
      projectSpace={projectSpace}
      projectTab={tab}
      onProjectTabChange={onTabChange}
      data={commercial}
      loading={query.isPending}
      error={query.isError}
      retry={() => {
        void query.refetch();
      }}
    />
  );
}

function CommercialStatus({
  loading,
  error,
  retry,
  unavailable = false,
}: {
  unavailable?: boolean;
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  return error ? (
    <div role="alert">
      <Trans>Commercial view unavailable</Trans>
      <Button variant="ghost" onClick={retry}>
        <Trans>Retry</Trans>
      </Button>
    </div>
  ) : loading ? (
    <p role="status">
      <Trans>Loading commercial view…</Trans>
    </p>
  ) : unavailable ? (
    <p className="text-body text-muted-foreground">
      <Trans>Commercial view unavailable</Trans>
    </p>
  ) : null;
}

function ClaimLinks({ data, onClaims }: { data: ProjectCommercial; onClaims?: () => void }) {
  return data.claims.length ? (
    <ul className="ps-3">
      {data.claims.map((claim) => (
        <li key={claim.id}>
          {onClaims ? (
            <Button variant="link" onClick={onClaims}>
              {claim.name}
            </Button>
          ) : (
            <a
              className="text-body underline"
              href={data.project.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {claim.name}
            </a>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-body text-muted-foreground">
      <Trans>No claims</Trans>
    </p>
  );
}

function ProjectPreview({
  scope,
  selection,
  projectId,
}: {
  scope: { userId: string | null; spaceId: string | null };
  selection: ProjectSelection;
  projectId: string;
}) {
  const query = useProjectCommercial(
    scope.userId,
    scope.spaceId,
    projectId,
    selection.revision,
    selection.botId,
  );
  return (
    <>
      <CommercialStatus
        loading={query.isPending}
        unavailable={!query.data}
        error={query.isError}
        retry={() => {
          void query.refetch();
        }}
      />
      {!query.isError && query.data ? <ClaimLinks data={query.data} /> : null}
    </>
  );
}
