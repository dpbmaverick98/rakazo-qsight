import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { withSpaceHeaders } from "../../lib/rpc";

export function CommercialSelection({
  userId,
  spaceId,
  projectId,
  back,
}: {
  userId: string | null;
  spaceId: string | null;
  projectId: string;
  back: () => void;
}) {
  const query = useQuery({
    queryKey: ["project-commercial", userId, spaceId, projectId],
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/agent-plane/projects/${encodeURIComponent(projectId)}/commercial`,
        {
          headers: withSpaceHeaders(undefined, spaceId),
          credentials: "include",
          signal,
        },
      );
      if (!response.ok || response.status === 204) throw new Error("Commercial view unavailable");
      const data = ProjectCommercialSchema.parse(await response.json());
      if (data.project.id !== projectId) throw new Error("Project mismatch");
      return data;
    },
  });
  return (
    <CommercialPanel
      data={query.isFetching || query.isError ? undefined : query.data}
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
  loading,
  error,
  retry,
  back,
}: {
  data?: ProjectCommercial;
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
