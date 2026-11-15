// @vitest-environment jsdom
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectManagerAction } from "./project-manager";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), provision: vi.fn(), rpcForSpace: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../lib/rpc", () => ({ rpcForSpace: mocks.rpcForSpace }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
let close: () => Promise<void>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Browser must not mint tokens");
    }),
  );
  mocks.rpcForSpace.mockReturnValue({
    mcp: { servers: { provisionProjectManager: mocks.provision } },
  });
  mocks.provision.mockResolvedValue({ bot: { id: "pm" }, server: { id: "scoped" }, created: true });
});
afterEach(async () => {
  await close?.();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
async function mount(onOpenBot?: () => void) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectManagerAction
        project={commercialFixture.project}
        client="Example Client"
        spaceId="space"
        onOpenBot={onOpenBot}
      />,
    ),
  );
  close = async () => {
    await act(async () => root.unmount());
  };
  return {
    container,
    click: async () => {
      await act(async () => container.querySelector("button")!.click());
    },
  };
}
it.each([true, false])("opens the server-provisioned PM (created=%s)", async (created) => {
  mocks.provision.mockResolvedValue({ bot: { id: "pm" }, server: { id: "scoped" }, created });
  const view = await mount();
  await view.click();
  expect(mocks.rpcForSpace).toHaveBeenCalledWith("space");
  expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({
    projectId: "roof",
    projectName: "Roof survey",
    clientName: "Example Client",
  });
  expect(mocks.navigate).toHaveBeenCalledWith("/app/pm");
});
it("shows a minimal error and retries the same atomic RPC", async () => {
  mocks.provision.mockRejectedValueOnce(new Error("private upstream detail"));
  const view = await mount();
  await view.click();
  expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not create project manager. Try again.",
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
  await view.click();
  expect(mocks.provision).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(mocks.navigate).toHaveBeenCalledWith("/app/pm");
});
it("disables repeated clicks while waiting", async () => {
  let finish!: (value: unknown) => void;
  mocks.provision.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = await mount();
  await view.click();
  await view.click();
  expect(view.container.querySelector("button")!.disabled).toBe(true);
  expect(mocks.provision).toHaveBeenCalledTimes(1);
  await act(async () => finish({ bot: { id: "pm" } }));
  expect(view.container.querySelector("button")!.disabled).toBe(false);
});
it("opens through the panel callback and ignores late results after unmount", async () => {
  const onOpenBot = vi.fn();
  const view = await mount(onOpenBot);
  await view.click();
  expect(onOpenBot).toHaveBeenCalledWith({ id: "pm" });
  expect(mocks.navigate).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  mocks.provision.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await view.click();
  await close();
  await act(async () => finish({ bot: { id: "late" } }));
  expect(onOpenBot).toHaveBeenCalledTimes(1);
});
