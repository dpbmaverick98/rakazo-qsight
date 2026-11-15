// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarExpansion } from "./use-sidebar-expansion";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("restores expansion preferences per user with Space and binding revision in node keys", async () => {
  const root = createRoot(document.createElement("div"));
  let state: ReturnType<typeof useSidebarExpansion>;
  function Harness({ userId }: { userId: string }) {
    state = useSidebarExpansion(userId);
    return null;
  }
  const key = "client:space:1:building:north";
  await act(async () => root.render(<Harness userId="first" />));
  await act(async () => state.toggleSidebarSection(key));
  expect(state!.collapsedSidebarSections.has(key)).toBe(true);
  await act(async () => root.render(<Harness userId="second" />));
  expect(state!.collapsedSidebarSections.has(key)).toBe(false);
  await act(async () => root.render(<Harness userId="first" />));
  expect(state!.collapsedSidebarSections.has(key)).toBe(true);
  expect(state!.collapsedSidebarSections.has("client:space:2:building:north")).toBe(false);
  expect(state!.collapsedSidebarSections.has("client:other:1:building:north")).toBe(false);
  await act(async () => root.unmount());
  const next = createRoot(document.createElement("div"));
  await act(async () => next.render(<Harness userId="first" />));
  expect(state!.collapsedSidebarSections.has(key)).toBe(true);
  await act(async () => next.unmount());
});
