// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectMutationDialog } from "./project-actions";

vi.mock("../../lib/rpc", () => ({
  withSpaceHeaders: (headers: HeadersInit, spaceId: string) =>
    new Headers({ ...Object.fromEntries(new Headers(headers)), "x-rakazo-space-id": spaceId }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => vi.unstubAllGlobals());
for (const action of ["rename", "delete"] as const)
  it(`${action} validates confirmation and sends a scoped mutation`, async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const queries = new QueryClient();
    const invalidated = vi.spyOn(queries, "invalidateQueries");
    const closed = vi.fn();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queries}>
            <ProjectMutationDialog
              action={action}
              project={{ id: "roof", name: "Roof works" }}
              spaceId="space"
              bindingRevision={3}
              onClose={closed}
            />
          </QueryClientProvider>,
        ),
      );
      const input = document.querySelector("input")!;
      const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const fill = async (value: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            value,
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      if (action === "delete") {
        expect(document.body.textContent).toContain("work packages and documents");
        expect(submit().disabled).toBe(true);
        await fill("roof works");
        expect(submit().disabled).toBe(true);
        await fill("Roof works ");
        expect(submit().disabled).toBe(true);
      }
      await fill(action === "delete" ? "Roof works" : "New scope");
      expect(submit().disabled).toBe(false);
      await act(async () =>
        document
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/agent-plane/projects/roof",
        expect.objectContaining({
          method: action === "delete" ? "DELETE" : "PATCH",
          body: JSON.stringify({ name: action === "delete" ? "Roof works" : "New scope" }),
        }),
      );
      const headers = fetch.mock.calls[0]?.[1]?.headers as Headers;
      expect(headers.get("x-rakazo-space-id")).toBe("space");
      expect(headers.get("x-rakazo-binding-revision")).toBe("3");
      expect(closed).toHaveBeenCalled();
      expect(invalidated).toHaveBeenCalledWith({ queryKey: ["client-navigation"] });
    } finally {
      await act(async () => root.unmount());
      document.body.innerHTML = "";
      queries.clear();
    }
  });
