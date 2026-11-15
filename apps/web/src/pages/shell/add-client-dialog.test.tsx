// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AddClientDialog } from "./add-client-dialog";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/rpc", () => ({
  withSpaceHeaders: (headers: HeadersInit) => new Headers(headers),
}));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onDone = vi.fn();
  await act(async () => root.render(<AddClientDialog onCancel={vi.fn()} onDone={onDone} />));
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      " Example Client ",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { onDone, input };
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
const missing = {
  clientId: "client",
  spaceId: "space",
  botId: "pm",
  serverId: null,
  status: "mcp_missing",
};
it("shows one field, preserves missing-MCP setup and resumes the same PM on retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(missing))
    .mockResolvedValueOnce(Response.json({ ...missing, serverId: "tools", status: "ready" }));
  vi.stubGlobal("fetch", fetch);
  const { onDone, input } = await mount();
  expect(document.querySelectorAll("input")).toHaveLength(1);
  expect(input.labels?.[0]?.textContent).toBe("Client name");
  await submit();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("PM saved.");
  expect(onDone).not.toHaveBeenCalled();
  expect(input.disabled).toBe(true);
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "Open PM"),
  ).toBe(true);
  await submit();
  expect(onDone).toHaveBeenCalledWith({ ...missing, serverId: "tools", status: "ready" });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, options] of fetch.mock.calls)
    expect(JSON.parse(options.body)).toEqual({ name: "Example Client" });
});
it("retains the name after conflicts and network failure so Retry can complete", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: "binding_conflict" }, { status: 409 }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ ...missing, status: "ready", serverId: "tools" }));
  vi.stubGlobal("fetch", fetch);
  const { onDone, input } = await mount();
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("existing binding");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  await submit();
  expect(onDone).toHaveBeenCalledOnce();
});
