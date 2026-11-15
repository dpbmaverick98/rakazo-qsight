import { Trans, useLingui } from "@lingui/react/macro";
import type { Hierarchy } from "@rakazo/contracts/hierarchy";
import { HierarchySchema } from "@rakazo/contracts/hierarchy";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { withSpaceHeaders } from "../../lib/rpc";

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
}: {
  data?: Hierarchy | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  collapse: () => void;
}) {
  const { t } = useLingui();
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
        <nav aria-label={t`Buildings and projects`}>
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
                            <a
                              href={project.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-md py-2 text-body underline decoration-border underline-offset-4 break-words hover:decoration-foreground focus-visible:outline focus-visible:outline-ring"
                              aria-label={t`${project.name} (opens in new tab)`}
                            >
                              {project.name}
                            </a>
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
    </section>
  );
}
