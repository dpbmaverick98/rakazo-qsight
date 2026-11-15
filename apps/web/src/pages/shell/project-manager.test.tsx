// @vitest-environment jsdom
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectManagerAction } from "./project-manager";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rpc: {
    bots: { list: vi.fn(), create: vi.fn() },
    mcp: {
      servers: { list: vi.fn() },
      assignments: { list: vi.fn(), replace: vi.fn() },
    },
  },
  rpcForSpace: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../lib/rpc", () => ({ rpcForSpace: mocks.rpcForSpace }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let close: () => Promise<void>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No external writes allowed");
    }),
  );
  mocks.rpcForSpace.mockReturnValue(mocks.rpc);
  mocks.rpc.bots.list.mockResolvedValue([]);
  mocks.rpc.bots.create.mockResolvedValue({ id: "new-bot" });
  mocks.rpc.mcp.servers.list.mockResolvedValue([
    { id: "tools", name: "QSight Pilot", enabled: true },
  ]);
  mocks.rpc.mcp.assignments.list.mockResolvedValue([]);
  mocks.rpc.mcp.assignments.replace.mockResolvedValue([]);
});
afterEach(async () => {
  await close?.();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
async function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ProjectManagerAction
        project={commercialFixture.project}
        client="Example Client"
        spaceId="space"
      />,
    ),
  );
  close = async () => {
    await act(async () => root.unmount());
  };
  return {
    container,
    button: () => container.querySelector("button")!,
    click: async () => {
      await act(async () => container.querySelector("button")!.click());
    },
  };
}
it("opens an exact existing active bot without creating or assigning", async () => {
  mocks.rpc.bots.list.mockResolvedValue([
    { id: "wrong", name: "PM — Roof survey extra" },
    { id: "archived", name: "PM — Roof survey", archivedAt: "yesterday" },
    { id: "existing", name: "PM — Roof survey" },
  ]);
  const view = await mount();
  await view.click();
  expect(mocks.navigate).toHaveBeenCalledWith("/app/existing");
  expect(mocks.rpc.bots.create).not.toHaveBeenCalled();
  expect(mocks.rpc.mcp.servers.list).not.toHaveBeenCalled();
  expect(mocks.rpcForSpace).toHaveBeenCalledWith("space");
});
it("creates a persistent bot and appends without changing assignments for other bots", async () => {
  mocks.rpc.mcp.assignments.list.mockResolvedValue([
    { serverId: "other", allowAllTools: false, allowedTools: ["read"], id: "assignment" },
  ]);
  const view = await mount();
  await view.click();
  expect(mocks.rpc.bots.create).toHaveBeenCalledExactlyOnceWith({
    name: "PM — Roof survey",
    instructions: expect.any(String),
    dailyCheckIns: false,
    fleetManagement: false,
  });
  expect(mocks.rpc.mcp.assignments.list).toHaveBeenCalledWith({ botId: "new-bot" });
  expect(mocks.rpc.mcp.assignments.replace).toHaveBeenCalledExactlyOnceWith({
    botId: "new-bot",
    assignments: [
      { serverId: "other", allowAllTools: false, allowedTools: ["read"] },
      { serverId: "tools", allowAllTools: true, allowedTools: [] },
    ],
  });
  expect(mocks.navigate).toHaveBeenCalledWith("/app/new-bot");
});
it("reports attachment failure and retries on the retained bot", async () => {
  mocks.rpc.mcp.assignments.replace.mockRejectedValueOnce(new Error("Denied"));
  const view = await mount();
  await view.click();
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("created, but");
  expect(view.container.textContent).toContain("Open project manager");
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(view.button().textContent).toBe("Retry connection");
  await view.click();
  expect(mocks.rpc.bots.create).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).toHaveBeenCalledWith("/app/new-bot");
});
it("disables the action while provisioning and ignores repeated clicks", async () => {
  let finish!: (bots: never[]) => void;
  mocks.rpc.bots.list.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = await mount();
  await view.click();
  expect(view.button().disabled).toBe(true);
  expect(view.button().getAttribute("aria-busy")).toBe("true");
  expect(view.button().textContent).toBe("Creating…");
  await view.click();
  expect(mocks.rpc.bots.list).toHaveBeenCalledTimes(1);
  await act(async () => finish([]));
  expect(view.button().disabled).toBe(false);
});
it("retains the bot when the named server is unavailable", async () => {
  mocks.rpc.mcp.servers.list.mockResolvedValue([]);
  const view = await mount();
  await view.click();
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  expect(mocks.rpc.mcp.assignments.replace).not.toHaveBeenCalled();
  await act(async () =>
    [...view.container.querySelectorAll("button")]
      .find((b) => b.textContent === "Open project manager")!
      .click(),
  );
  expect(mocks.navigate).toHaveBeenCalledWith("/app/new-bot");
});
it("fails closed if reading current assignments fails", async () => {
  mocks.rpc.mcp.assignments.list.mockRejectedValue(new Error("Denied"));
  const view = await mount();
  await view.click();
  expect(mocks.rpc.mcp.assignments.replace).not.toHaveBeenCalled();
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
});
it("does not navigate after the project action is unmounted", async () => {
  let finish!: (bots: { id: string; name: string }[]) => void;
  mocks.rpc.bots.list.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = await mount();
  await view.click();
  await close();
  close = async () => {};
  await act(async () => finish([{ id: "existing", name: "PM — Roof survey" }]));
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it("skips replacement when the server is already attached", async () => {
  mocks.rpc.mcp.assignments.list.mockResolvedValue([
    { serverId: "tools", allowAllTools: false, allowedTools: ["read"] },
  ]);
  const view = await mount();
  await view.click();
  expect(mocks.rpc.mcp.assignments.replace).not.toHaveBeenCalled();
  expect(mocks.navigate).toHaveBeenCalledWith("/app/new-bot");
});
it("reports creation failure and checks the roster again on retry", async () => {
  mocks.rpc.bots.create.mockRejectedValueOnce(new Error("Response lost"));
  const view = await mount();
  await view.click();
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Could not create");
  expect(mocks.rpc.mcp.servers.list).not.toHaveBeenCalled();
  mocks.rpc.bots.list.mockResolvedValue([{ id: "recovered", name: "PM — Roof survey" }]);
  await view.click();
  expect(mocks.rpc.bots.create).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).toHaveBeenCalledWith("/app/recovered");
});
