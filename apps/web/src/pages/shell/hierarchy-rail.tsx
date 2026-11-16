import { Trans, useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Building } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { lazyComponent } from "../../lib/preload-recovery";
import { withSpaceHeaders } from "../../lib/rpc";
import { hierarchyRetry } from "./hierarchy-refresh";
import { CommercialSelection, ProjectActivity } from "./project-commercial";

const BuildingMap = lazyComponent(() => import("./building-map").then((module) => module.default));

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

export function HierarchyRail({
  data,
  loading,
  scope,
  projectId,
  error,
  retry,
}: {
  projectId?: string;
  scope?: { userId: string | null; spaceId: string | null };
  data?: Hierarchy | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  collapse: () => void;
}) {
  const { t } = useLingui();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedProject = data?.buildings
    .flatMap((building) => building.projects)
    .find((project) => project.id === selected);
  return (
    <section
      aria-label={t`Client hierarchy`}
      className="@container rk-scroll min-h-0 overflow-y-auto px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionHeading variant="label" className="min-w-0 break-words">
          <Trans>Workspace artifacts</Trans>
        </SectionHeading>
      </div>
      {data ? (
        <h2 className="mb-4 text-heading1 font-semibold tracking-tight break-words">
          {data.client.name}
        </h2>
      ) : null}
      {error ? (
        <div role="alert">
          <Trans>Hierarchy unavailable</Trans>
          <Button variant="ghost" onClick={retry}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {!loading && !error && !data?.buildings.length ? (
        <p className="text-body text-muted-foreground">
          <Trans>Select a project manager</Trans>
        </p>
      ) : null}
      {loading && !data?.buildings.length ? (
        <p role="status" className="text-body text-muted-foreground">
          <Trans>Loading hierarchy…</Trans>
        </p>
      ) : null}
      {data ? (
        <nav
          aria-label={t`Buildings and projects`}
          className={selectedProject ? "max-h-48 overflow-y-auto" : undefined}
        >
          {data.buildings.some(
            (building) => building.latitude != null && building.longitude != null,
          ) ? (
            <ErrorBoundary fallback={null}>
              <Suspense fallback={null}>
                <div className="mb-3 h-40 overflow-hidden rounded-md border border-border @min-[300px]:h-48">
                  <BuildingMap buildings={data.buildings} />
                </div>
              </Suspense>
            </ErrorBoundary>
          ) : null}
          {data.buildings.length > 0 ? (
            <ul className="flex flex-col gap-5">
              {data.buildings.map((building) => (
                <li key={building.id}>
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
                    summary={
                      <span className="flex min-w-0 items-start gap-2">
                        <Building
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 break-words">{building.name}</span>
                      </span>
                    }
                    summaryClassName="min-h-10 w-full justify-between gap-2 text-start text-body font-medium"
                  >
                    {building.address?.trim() &&
                    building.address.trim().toLocaleLowerCase() !==
                      building.name.trim().toLocaleLowerCase() ? (
                      <p className="mb-2 ps-6 text-caption text-muted-foreground break-words">
                        {building.address}
                      </p>
                    ) : null}
                    {building.projects.length === 0 ? (
                      <p className="ps-4 text-body text-muted-foreground">
                        <Trans>No projects</Trans>
                      </p>
                    ) : (
                      <ul className="ms-2 border-s border-border ps-3">
                        {building.projects.map((project) => (
                          <li key={project.id}>
                            <Button
                              variant="ghost"
                              className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-start break-words"
                              aria-pressed={(projectId ?? selected) === project.id}
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
          projectId={selectedProject.id}
          back={() => {
            setSelected(null);
            selectionTrigger.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
