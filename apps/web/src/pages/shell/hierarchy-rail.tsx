import { Trans, useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";
import { CommercialSelection } from "./project-commercial";

export function useHierarchy(userId: string | null, spaceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["hierarchy", userId, spaceId],
    enabled: enabled && !!userId && !!spaceId,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agent-plane/hierarchy", {
        headers: withSpaceHeaders(undefined, spaceId),
        credentials: "include",
        signal,
      });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error("Hierarchy unavailable");
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
}: {
  scope?: { userId: string | null; spaceId: string | null };
  data?: Hierarchy | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  collapse: () => void;
}) {
  const { t } = useLingui();
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedProject = data?.buildings
    .flatMap((building) => building.projects)
    .find((project) => project.id === selected);
  return (
    <section
      aria-label={t`Client hierarchy`}
      className="rk-scroll min-h-0 overflow-y-auto px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionHeading className="min-w-0 break-words">
          {data?.client.name ?? t`Hierarchy`}
        </SectionHeading>
        <Button variant="ghost" size="sm" onClick={collapse} aria-label={t`Collapse hierarchy`}>
          <Trans>Hide</Trans>
        </Button>
      </div>
      {loading ? (
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
      {data ? (
        <nav
          aria-label={t`Buildings and projects`}
          className={selectedProject ? "max-h-48 overflow-y-auto" : undefined}
        >
          {data.buildings.length === 0 ? (
            <p className="text-body text-muted-foreground">
              <Trans>No buildings</Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.buildings.map((building) => (
                <li key={building.id}>
                  <Disclosure
                    summary={building.name}
                    summaryClassName="min-h-10 w-full justify-between break-words text-body"
                  >
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
                          </li>
                        ))}
                      </ul>
                    )}
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
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
