import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { withSpaceHeaders } from "../../lib/rpc";
import { hierarchyRetry } from "./hierarchy-refresh";
import { ProjectManagerAction } from "./project-manager";

export function CommercialSelection({
  userId,
  spaceId,
  projectId,
  client,
  onOpenBot,
  back,
}: {
  userId: string | null;
  spaceId: string | null;
  projectId: string;
  client: string;
  onOpenBot?: (bot: Bot) => void;
  back: () => void;
}) {
  const query = useProjectCommercial(userId, spaceId, projectId);
  return (
    <CommercialPanel
      onOpenBot={onOpenBot}
      managerScope={userId && spaceId ? { userId, spaceId, client } : undefined}
      data={query.isError ? undefined : (query.data ?? undefined)}
      loading={query.isFetching}
      error={query.isError}
      retry={() => {
        void query.refetch();
      }}
      back={back}
    />
  );
}

export function CommercialPanel({
  data,
  managerScope,
  onOpenBot,
  loading,
  error,
  retry,
  back,
}: {
  data?: ProjectCommercial;
  onOpenBot?: (bot: Bot) => void;
  managerScope?: { userId: string; spaceId: string; client: string };
  loading: boolean;
  error: boolean;
  retry: () => void;
  back: () => void;
}) {
  const { t } = useLingui();
  const labels = {
    proposed: t`Proposed`,
    breakdown: t`Breakdown`,
    invoiced: t`Invoiced`,
    remaining: t`Remaining`,
  };
  return (
    <section
      aria-label={t`Commercial`}
      aria-busy={loading}
      className="min-w-0 border-t border-border py-4"
    >
      <Button variant="ghost" size="sm" onClick={back}>
        <Trans>Back to hierarchy</Trans>
      </Button>
      {loading ? (
        <p role="status">
          <Trans>Loading commercial view…</Trans>
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>
            <Trans>Commercial view unavailable</Trans>
          </p>
          <Button variant="ghost" size="sm" onClick={retry}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {data ? (
        <>
          <SectionHeading className="break-words">{data.project.name}</SectionHeading>
          {managerScope ? (
            <ProjectManagerAction
              key={`${managerScope.userId}:${managerScope.spaceId}:${data.project.id}`}
              onOpenBot={onOpenBot}
              project={data.project}
              client={managerScope.client}
              spaceId={managerScope.spaceId}
            />
          ) : null}
          <p className="text-body text-muted-foreground">
            <Trans>Read-only</Trans>
            {data.project.currency ? <span className="ms-2">{data.project.currency}</span> : null}
          </p>
          <a
            className="text-body underline"
            href={data.project.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t`Open project (opens in new tab)`}
          >
            <Trans>Open project</Trans> ↗
          </a>
          {!data.claims.some((claim) =>
            claim.sub_vendors.some((vendor) => vendor.work_packages.length),
          ) ? (
            <p className="mt-3 text-body text-muted-foreground">
              <Trans>No active work packages yet</Trans>
            </p>
          ) : null}
          <ul className="mt-3 space-y-3">
            {data.claims.map((claim) => (
              <li key={claim.id}>
                <Disclosure
                  summary={claim.name}
                  summaryClassName="min-h-10 w-full justify-between break-words text-body"
                >
                  <ul className="border-s border-border ps-3">
                    {claim.sub_vendors.map((vendor) => (
                      <li key={vendor.id}>
                        <Disclosure
                          summary={vendor.name}
                          summaryClassName="min-h-10 w-full justify-between break-words text-body"
                        >
                          <ul className="space-y-3">
                            {vendor.work_packages.map((item) => (
                              <li
                                key={item.id}
                                className="rounded-md border border-border p-3 text-body break-words"
                              >
                                <h3 className="font-medium">{item.title}</h3>
                                <p className="text-muted-foreground">{item.status}</p>
                                <p className="text-muted-foreground">
                                  <Trans>{item.document_count} documents</Trans>
                                </p>
                                <p className="text-muted-foreground">{item.document_state}</p>
                                <dl className="my-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
                                  {(
                                    ["proposed", "breakdown", "invoiced", "remaining"] as const
                                  ).map((field) => (
                                    <div key={field} className="min-w-0">
                                      <dt className="text-muted-foreground">{labels[field]}</dt>
                                      <dd>
                                        {item[field] === null ? (
                                          <>
                                            <span aria-hidden="true">—</span>
                                            <span className="sr-only">
                                              <Trans>Not available</Trans>
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            {item[field]} {data.project.currency}
                                          </>
                                        )}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                {item.position ? <p>{item.position}</p> : null}
                                <p className="text-muted-foreground">
                                  {item.issues_open === null
                                    ? t`Issues unavailable`
                                    : t`${item.issues_open} open issues`}
                                </p>
                                {item.coverage_incomplete !== false ? (
                                  <p className="text-muted-foreground">
                                    {item.coverage_incomplete === null
                                      ? t`Checks unavailable`
                                      : t`Checks incomplete`}
                                  </p>
                                ) : null}
                                <a
                                  className="underline"
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={t`Open ${item.title} (opens in new tab)`}
                                >
                                  <Trans>Open work package</Trans> ↗
                                </a>
                              </li>
                            ))}
                          </ul>
                        </Disclosure>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function useProjectCommercial(
  userId: string | null,
  spaceId: string | null,
  projectId: string,
) {
  return useQuery<ProjectCommercial | null>({
    queryKey: ["project-commercial", userId, spaceId, projectId],
    enabled: !!userId && !!spaceId,
    retry: hierarchyRetry,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error && hierarchyRetry(0, query.state.error) ? 5_000 : false,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/agent-plane/projects/${encodeURIComponent(projectId)}/commercial`,
        {
          headers: withSpaceHeaders(undefined, spaceId),
          credentials: "include",
          signal,
        },
      );
      if (response.status === 204) return null;
      if (!response.ok)
        throw Object.assign(new Error("Commercial view unavailable"), { status: response.status });
      const data = ProjectCommercialSchema.parse(await response.json());
      if (data.project.id !== projectId) throw new Error("Project mismatch");
      return data;
    },
  });
}

export function ProjectActivity({
  userId,
  spaceId,
  projectId,
}: {
  userId: string;
  spaceId: string;
  projectId: string;
}) {
  const query = useProjectCommercial(userId, spaceId, projectId);
  const data = query.isError && !hierarchyRetry(0, query.error) ? undefined : query.data;
  const packages =
    data?.claims.flatMap((claim) => claim.sub_vendors.flatMap((vendor) => vendor.work_packages)) ??
    [];
  if (!packages.length) return null;
  return (
    <ul className="space-y-1 ps-4 text-body">
      {packages.map((item) => (
        <li key={item.id} className="break-words">
          <span>{item.title}</span>
          <span className="ms-2 text-muted-foreground">{item.status}</span>
        </li>
      ))}
    </ul>
  );
}
