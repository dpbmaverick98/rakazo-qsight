// @vitest-environment jsdom
import { commercialDocumentsFixture } from "@rakazo/contracts/project-commercial-fixture";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CommercialInspection, inspectionStorageKey } from "./commercial-inspection";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props: ComponentProps<typeof CommercialInspection> = {
    scope: "project-pm",
    ready: true,
    data: commercialDocumentsFixture,
    loading: false,
    error: false,
    retry: vi.fn(),
    projectSpace: null,
    projectTab: "claims",
    onProjectTabChange: vi.fn(),
  };
  async function render(patch: Partial<typeof props> = {}) {
    Object.assign(props, patch);
    await act(async () => root.render(<CommercialInspection key={props.scope} {...props} />));
  }
  await render();
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === name,
    )!;
  const click = async (name: string) => {
    await act(async () => button(name).click());
  };
  return {
    container,
    render,
    button,
    click,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it("shows authoritative claim totals and opens vendor/file tabs, closes to focused vendor tab", async () => {
  const view = await mount();
  try {
    await view.click("Finishes");
    expect(view.container.textContent).toContain("0 USD");
    expect(view.container.textContent).toContain("1234.50 USD");
    expect(view.container.textContent).toContain("Not available");
    await view.click("Example Interiors");
    expect(view.button("Sub vendors").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(view.button("Sub vendors"));
    expect(view.container.textContent).toContain("proposal ready");
    await view.click("Invoices");
    expect(view.container.textContent).toContain("invoice pending");
    await view.click("Invoice.pdf");
    expect(view.container.textContent).toContain("Preview unavailable");
    expect(view.container.querySelector("iframe,object,input,textarea,form")).toBeNull();
    const link = view.container.querySelector("a")!;
    expect(link.href).toContain("?document=invoice");
    expect(link.rel).toBe("noopener noreferrer");
    await view.click("Close file");
    expect(document.activeElement).toBe(view.button("Sub vendors"));
    expect(view.container.querySelector('[role="tab"][title="Invoice.pdf"]')).toBeNull();
  } finally {
    await view.close();
  }
});
it("restores only after fresh ancestry validation and isolates projects and managers", async () => {
  const view = await mount();
  try {
    await view.click("Finishes");
    await view.click("Example Interiors");
    await view.click("Proposal.pdf");
    await view.render({ scope: "other-pm" });
    expect(view.container.textContent).not.toContain("Preview unavailable");
    await view.render({ scope: "project-pm", ready: false });
    expect(view.container.textContent).not.toContain("Preview unavailable");
    await view.render({ ready: true });
    expect(view.container.textContent).toContain("Preview unavailable");
    await view.render({
      data: {
        ...commercialDocumentsFixture,
        project: { ...commercialDocumentsFixture.project, id: "other" },
        claims: [],
      },
    });
    expect(view.container.textContent).not.toContain("Preview unavailable");
    expect(sessionStorage.getItem(inspectionStorageKey("project-pm"))).toBeNull();
    expect(JSON.stringify([...Object.values(sessionStorage)])).not.toContain("https:");
  } finally {
    await view.close();
  }
});
it("clears saved inspection on denied reads and removed files", async () => {
  const view = await mount();
  try {
    await view.click("Finishes");
    await view.click("Example Interiors");
    await view.click("Proposal.pdf");
    const data = structuredClone(commercialDocumentsFixture);
    data.claims[0]!.sub_vendors[0]!.work_packages[0]!.documents = [];
    await view.render({ data });
    expect(view.container.textContent).not.toContain("Preview unavailable");
    expect(sessionStorage.getItem(inspectionStorageKey("project-pm"))).toBeNull();
    await view.render({ data: undefined, error: true });
    expect(view.container.textContent).toContain("Commercial view unavailable");
  } finally {
    await view.close();
  }
});

it("renders current package amounts in each category, preserving null and both forms of zero", async () => {
  const view = await mount();
  try {
    const data = structuredClone(commercialDocumentsFixture);
    const item = data.claims[0]!.sub_vendors[0]!.work_packages[0]!;
    item.proposed = null;
    item.breakdown = 0;
    item.invoiced = "0";
    await view.render({ data });
    await view.click("Finishes");
    await view.click("Example Interiors");
    const panel = () =>
      view.container.querySelector(
        '[role="tabpanel"][data-state="active"] [role="tabpanel"][data-state="active"]',
      )?.textContent ?? view.container.textContent;
    expect(panel()).toContain("Not available");
    await view.click("Breakdown");
    expect(panel()).toContain("0 USD");
    await view.click("Invoices");
    expect(panel()).toContain("0 USD");
    expect(panel()).toContain("Invoice.pdf");
    item.invoiced = "987.65";
    await view.render({ data: structuredClone(data) });
    expect(panel()).toContain("987.65 USD");
  } finally {
    await view.close();
  }
});
