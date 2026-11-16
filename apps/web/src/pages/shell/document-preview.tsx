import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { withSpaceHeaders } from "../../lib/rpc";

/** Content lives only in the mounted DOM or a revoked-on-close blob URL. */
export function DocumentPreview({
  url,
  revision,
  name,
}: {
  url: string;
  revision: number;
  name: string;
}) {
  const text = useRef<HTMLPreElement>(null);
  const [preview, setPreview] = useState<{ kind: string; url?: string }>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview({ kind: "loading" });
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: withSpaceHeaders({ "x-rakazo-binding-revision": String(revision) }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 415) {
          setPreview({ kind: "unsupported" });
          return;
        }
        if (!response.ok) throw new Error();
        const type = response.headers.get("content-type")?.split(";")[0];
        if (type === "text/markdown" || type === "text/plain") {
          const content = await response.text();
          if (controller.signal.aborted) return;
          if (text.current) text.current.textContent = content;
          setPreview({ kind: "text" });
        } else if (
          type === "application/pdf" ||
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type ?? "")
        ) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: type === "application/pdf" ? "pdf" : "image", url: objectUrl });
        } else setPreview({ kind: "unsupported" });
      } catch {
        if (!controller.signal.aborted) setPreview({ kind: "error" });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (text.current) text.current.textContent = "";
    };
  }, [url, revision]);
  return (
    <>
      {preview.kind === "loading" ? (
        <p role="status">
          <Trans>Loading preview…</Trans>
        </p>
      ) : null}
      {preview.kind === "error" || preview.kind === "unsupported" ? (
        <div role="status">
          <p>
            <Trans>Preview unavailable</Trans>
          </p>
        </div>
      ) : null}
      <pre
        ref={text}
        hidden={preview.kind !== "text"}
        className="whitespace-pre-wrap break-words text-body"
      />
      {/* Native PDF viewers reject sandboxed frames. As with PdfViewer, only
          allowlisted PDF blobs enter this frame, under the app's CSP. */}
      {preview.kind === "pdf" ? (
        <iframe
          title={name}
          src={`${preview.url}#toolbar=0`}
          referrerPolicy="no-referrer"
          className="w-full h-[70vh] border-0"
        />
      ) : null}
      {preview.kind === "image" ? (
        <img src={preview.url} alt={name} className="max-w-full" />
      ) : null}
    </>
  );
}
