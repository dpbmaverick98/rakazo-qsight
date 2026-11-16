import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@rakazo/ui-web";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { DocumentPreview } from "./document-preview";
import type { InspectionSelection as Selection } from "./inspection-storage";
import { inspectionStorageKey, restoreInspection } from "./inspection-storage";
import { CommercialPanel } from "./project-commercial";

export { inspectionStorageKey } from "./inspection-storage";

const amountFields = { proposal: "proposed", breakdown: "breakdown", invoice: "invoiced" } as const;

/** Only identities are remembered. Every render resolves them against an authorized fresh read. */
export function CommercialInspection({
  scope,
  previewContext,
  ready,
  projectSpace,
  projectTab,
  onProjectTabChange,
  ...props
}: ComponentProps<typeof CommercialPanel> & {
  scope: string;
  previewContext?: { botId: string; projectId: string; revision: number };
  ready: boolean;
  projectSpace: ReactNode;
  projectTab: "space" | "claims";
  onProjectTabChange: (tab: "space" | "claims") => void;
}) {
  const { t } = useLingui();
  const key = inspectionStorageKey(scope);
  const [selection, setSelection] = useState<Selection | null>(() => restoreInspection(key));
  const [tab, setTab] = useState(() => restoreInspection(key)?.tab ?? "claims");
  const [role, setRole] = useState("proposal");
  const vendorTab = useRef<HTMLButtonElement>(null);
  const fileTab = useRef<HTMLButtonElement>(null);
  const claimsTab = useRef<HTMLButtonElement>(null);
  const previousProjectTab = useRef(projectTab);
  const claim = ready
    ? props.data?.claims.find((item) => item.id === selection?.claimId)
    : undefined;
  const vendor = claim?.sub_vendors.find((item) => item.id === selection?.vendorId);
  const workPackage = vendor?.work_packages.find((item) => item.id === selection?.packageId);
  const file = workPackage?.documents?.find((item) => item.id === selection?.fileId);
  const valid =
    !!claim &&
    (!selection?.vendorId || !!vendor) &&
    (!selection?.packageId || !!workPackage) &&
    (!selection?.fileId || !!file);
  useEffect(() => {
    if (!ready) return;
    if (!valid || !selection) {
      sessionStorage.removeItem(key);
      setSelection(null);
    } else
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...selection, tab: projectTab === "space" ? "space" : tab }),
      );
  }, [ready, valid, selection, key, tab, projectTab]);
  useEffect(() => {
    if (projectTab !== "claims") return;
    if (tab === "file" && file) fileTab.current?.focus();
    else if (tab === "vendor" && valid) vendorTab.current?.focus();
  }, [tab, selection, valid, file, projectTab]);
  useEffect(() => {
    if (previousProjectTab.current === "space" && projectTab === "claims") {
      setTab("claims");
      claimsTab.current?.focus();
    }
    previousProjectTab.current = projectTab;
  }, [projectTab]);
  function closeFile() {
    setSelection(selection ? { claimId: selection.claimId, vendorId: selection.vendorId } : null);
    setTab("vendor");
    vendorTab.current?.focus();
  }
  const activeTab =
    projectTab === "space"
      ? "space"
      : valid && (tab === "vendor" || (tab === "file" && file))
        ? tab
        : "claims";
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        setTab(value);
        onProjectTabChange(value === "space" ? "space" : "claims");
      }}
    >
      <TabsList
        aria-label={t`Project views`}
        variant="line"
        className="max-w-full overflow-x-auto justify-start"
      >
        <TabsTrigger value="space">
          <Trans>Project space</Trans>
        </TabsTrigger>
        <TabsTrigger value="claims" ref={claimsTab}>
          <Trans>Claims</Trans>
        </TabsTrigger>
        {valid && vendor ? (
          <TabsTrigger value="vendor" ref={vendorTab}>
            <Trans>Sub vendors</Trans>
          </TabsTrigger>
        ) : null}
        {valid && file ? (
          <TabsTrigger
            value="file"
            ref={fileTab}
            className="max-w-40 truncate"
            title={file.filename}
          >
            {file.filename}
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="space">{projectSpace}</TabsContent>
      <TabsContent value="claims">
        <CommercialPanel
          {...props}
          onClaim={(claimId) => setSelection({ claimId })}
          onVendor={(claimId, vendorId) => {
            setSelection({ claimId, vendorId });
            setTab("vendor");
          }}
        />
      </TabsContent>
      {valid && vendor && claim ? (
        <>
          <TabsContent value="vendor">
            <h2 className="my-3 font-medium break-words">
              {claim.name} / {vendor.name}
            </h2>
            <Tabs value={role} onValueChange={setRole}>
              <TabsList aria-label={t`Documents`} variant="line">
                <TabsTrigger value="proposal">
                  <Trans>Proposal</Trans>
                </TabsTrigger>
                <TabsTrigger value="breakdown">
                  <Trans>Breakdown</Trans>
                </TabsTrigger>
                <TabsTrigger value="invoice">
                  <Trans>Invoices</Trans>
                </TabsTrigger>
                {vendor.work_packages.some((item) =>
                  item.documents?.some(
                    (document) => !["proposal", "breakdown", "invoice"].includes(document.role),
                  ),
                ) ? (
                  <TabsTrigger value="other">
                    <Trans>Other</Trans>
                  </TabsTrigger>
                ) : null}
              </TabsList>
              {(["proposal", "breakdown", "invoice", "other"] as const).map((category) => (
                <TabsContent value={category} key={category}>
                  <ul className="flex flex-col gap-3 py-3">
                    {vendor.work_packages.map((item) => (
                      <li key={item.id}>
                        <h3 className="font-medium break-words">
                          <Button
                            variant="link"
                            onClick={() =>
                              setSelection({
                                claimId: claim.id,
                                vendorId: vendor.id,
                                packageId: item.id,
                              })
                            }
                          >
                            {item.title}
                          </Button>
                        </h3>
                        {category !== "other" ? (
                          <p className="tabular-nums">
                            {item[amountFields[category]] === null
                              ? t`Not available`
                              : `${item[amountFields[category]]} ${props.data?.project.currency ?? ""}`}
                          </p>
                        ) : null}
                        {item.documents === undefined ? (
                          <p className="text-muted-foreground">
                            <Trans>Document metadata unavailable</Trans>
                          </p>
                        ) : (
                          <ul>
                            {item.documents
                              .filter(
                                (document) =>
                                  document.role === category ||
                                  (category === "other" &&
                                    !["proposal", "breakdown", "invoice"].includes(document.role)),
                              )
                              .map((document) => (
                                <li key={document.id} className="py-2 break-words">
                                  <Button
                                    variant="link"
                                    onClick={() => {
                                      setSelection({
                                        claimId: claim.id,
                                        vendorId: vendor.id,
                                        packageId: item.id,
                                        fileId: document.id,
                                      });
                                      setTab("file");
                                    }}
                                  >
                                    {document.filename}
                                  </Button>
                                  <p className="text-muted-foreground">
                                    <DocumentLabels role={document.role} status={document.status} />
                                  </p>
                                  <RecordLink url={document.url} />
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>
          {file ? (
            <TabsContent value="file">
              <Button variant="ghost" onClick={closeFile}>
                <Trans>Close file</Trans>
              </Button>
              <h2 className="my-3 font-medium break-words">{file.filename}</h2>
              <p className="text-muted-foreground">
                <DocumentLabels role={file.role} status={file.status} />
              </p>
              {previewContext && selection && activeTab === "file" ? (
                <DocumentPreview
                  key={file.id}
                  url={`/api/agent-plane/projects/${encodeURIComponent(previewContext.projectId)}/documents/${encodeURIComponent(file.id)}/preview?${new URLSearchParams({ botId: previewContext.botId, claimId: claim.id, vendorId: vendor.id, packageId: workPackage!.id })}`}
                  revision={previewContext.revision}
                  name={file.filename}
                  externalUrl={file.url}
                />
              ) : (
                <>
                  <p>
                    <Trans>Preview unavailable</Trans>
                  </p>
                  <RecordLink url={file.url} />
                </>
              )}
            </TabsContent>
          ) : null}
        </>
      ) : null}
    </Tabs>
  );
}

function RecordLink({ url }: { url: string }) {
  return (
    <a className="text-body underline" href={url} target="_blank" rel="noopener noreferrer">
      <Trans>Open record</Trans> ↗
    </a>
  );
}

function documentRoleLabel(role: string) {
  switch (role) {
    case "proposal":
      return <Trans>Proposal</Trans>;
    case "breakdown":
      return <Trans>Breakdown</Trans>;
    case "invoice":
      return <Trans>Invoice</Trans>;
    case "support":
      return <Trans>Support</Trans>;
    case "change_order":
      return <Trans>Change order</Trans>;
    default:
      return <Trans>Document</Trans>;
  }
}

function documentStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return <Trans>Ready</Trans>;
    case "parsing":
      return <Trans>Processing</Trans>;
    case "uploading":
      return <Trans>Uploading</Trans>;
    case "failed":
      return <Trans>Failed</Trans>;
    default:
      return null;
  }
}

function DocumentLabels({ role, status }: { role: string; status: string }) {
  const statusLabel = documentStatusLabel(status);
  return (
    <>
      <span>{documentRoleLabel(role)}</span>
      {statusLabel ? (
        <>
          {" "}
          <span>{statusLabel}</span>
        </>
      ) : null}
    </>
  );
}
