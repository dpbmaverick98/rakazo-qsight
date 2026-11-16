// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentPreview } from "./document-preview";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/rpc", () => ({ withSpaceHeaders: (headers: HeadersInit) => headers }));
afterEach(() => vi.unstubAllGlobals());
it.each(["application/pdf", "image/png", "text/markdown", "text/html"])(
  "renders %s safely and clears content on close",
  async (type) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<script>literal text</script>", { headers: { "Content-Type": type } }),
      ),
    );
    const create = vi.fn(() => "blob:preview");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DocumentPreview
          url="/preview"
          revision={1}
          name="Document"
          externalUrl="https://example.test/record"
        />,
      );
    });
    expect(container.querySelector("script")).toBeNull();
    if (type === "text/markdown") {
      expect(container.querySelector("pre")?.textContent).toBe("<script>literal text</script>");
    } else if (type === "application/pdf") {
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe("blob:preview#toolbar=0");
      expect(container.querySelector("iframe")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    } else if (type === "image/png")
      expect(container.querySelector("img")?.src).toContain("blob:preview");
    else expect(container.textContent).toContain("Preview unavailable");
    await act(async () => root.unmount());
    if (type === "application/pdf" || type === "image/png")
      expect(revoke).toHaveBeenCalledWith("blob:preview");
  },
);

it.each([415, 502])("shows the external fallback for HTTP %s", async (status) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal("fetch", request);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <DocumentPreview
        url="/preview"
        revision={2}
        name="Document"
        externalUrl="https://example.test/record"
      />,
    ),
  );
  expect(container.textContent).toContain("Preview unavailable");
  expect(container.querySelector("a")?.href).toBe("https://example.test/record");
  expect(container.querySelector("iframe,img")).toBeNull();
  expect(request).toHaveBeenCalledWith(
    "/preview",
    expect.objectContaining({ cache: "no-store", headers: { "x-rakazo-binding-revision": "2" } }),
  );
  await act(async () => root.unmount());
});
