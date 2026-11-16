import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectCommercial } from "@rakazo/contracts/project-commercial";
import { ProjectCommercialSchema } from "@rakazo/contracts/project-commercial";
import { Button, Disclosure, SectionHeading } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { withSpaceHeaders } from "../../lib/rpc";
import { hierarchyRetry } from "./hierarchy-refresh";

export function CommercialPanel({
  data,
  loading,
  error,
  retry,
  onVendor,
  onClaim,
}: {
  onClaim?: (claimId: string) => void;
  onVendor?: (claimId: string, vendorId: string) => void;
  data?: ProjectCommercial;
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  const { t } = useLingui();
  const labels = {
    proposed: t`Proposed`,
    breakdown: t`Breakdown`,
    invoiced: t`Invoiced`,
    remaining: t`Remaining`,
  };
  return (
    <section aria-label={t`Commercial`} aria-busy={loading} className="min-w-0 py-4">
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
      {!data && !loading && !error ? (
        <p className="text-body text-muted-foreground">
          <Trans>Commercial view unavailable</Trans>
        </p>
      ) : null}
      {data ? (
        <>
          <SectionHeading className="break-words">{data.project.name}</SectionHeading>
          {!data.claims.length ? (
            <p className="mt-3 text-body text-muted-foreground">
              <Trans>No claims</Trans>
            </p>
          ) : null}
          <ul className="mt-3 space-y-3">
            {data.claims.map((claim) => (
              <li key={claim.id}>
                <Disclosure
                  onOpenChange={(open) => {
                    if (open) onClaim?.(claim.id);
                  }}
                  summary={claim.name}
                  summaryClassName="min-h-10 w-full justify-between break-words text-body"
                >
                  {claim.totals ? (
                    <dl className="my-2 grid grid-cols-2 gap-3 tabular-nums">
                      {(["proposed", "breakdown", "invoiced", "remaining"] as const).map(
                        (field) => (
                          <div key={field}>
                            <dt className="text-muted-foreground">{labels[field]}</dt>
                            <dd>
                              {claim.totals![field] === null
                                ? t`Not available`
                                : `${claim.totals![field]} ${data.project.currency ?? ""}`}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  ) : null}
                  <ul className="border-s border-border ps-3">
                    {claim.sub_vendors.map((vendor) => (
                      <li key={vendor.id}>
                        {onVendor ? (
                          <Button variant="link" onClick={() => onVendor(claim.id, vendor.id)}>
                            {vendor.name}
                          </Button>
                        ) : (
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
                                </li>
                              ))}
                            </ul>
                          </Disclosure>
                        )}
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
  revision?: number,
  botId?: string,
) {
  return useQuery<ProjectCommercial | null>({
    queryKey: ["project-commercial", userId, spaceId, projectId, revision, botId],
    enabled: !!userId && !!spaceId,
    retry: hierarchyRetry,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const headers = withSpaceHeaders(undefined, spaceId);
      if (revision !== undefined) headers.set("x-rakazo-binding-revision", String(revision));
      const response = await fetch(
        `/api/agent-plane/projects/${encodeURIComponent(projectId)}/commercial`,
        {
          headers,
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
