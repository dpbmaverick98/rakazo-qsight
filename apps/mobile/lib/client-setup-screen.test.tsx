// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClientSetupScreen from "../app/client-setup";
import { queryClient } from "./query";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  select: vi.fn(async () => true),
  setup: vi.fn(),
  refetch: vi.fn(),
  data: null as unknown,
  error: null as Error | null,
}));
vi.mock("./api", () => ({
  selectedSpaceId: () => "target",
  currentApiBase: () => "https://api.example.test",
  captureApiRequestContext: vi.fn(),
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => 1 }));
vi.mock("./api-server", () => ({ selectSpace: state.select }));
vi.mock("./client-setup", () => ({
  clientNavigationQuery: () => ({ queryKey: ["navigation"], queryFn: vi.fn() }),
  setupClient: state.setup,
}));
vi.mock("./screen-query", () => ({
  useScreenQuery: () => ({
    data: state.data,
    error: state.error,
    isPending: false,
    isError: !!state.error,
    refetch: state.refetch,
  }),
}));
vi.mock("./roster-signals", () => ({ useRosterSignals: vi.fn() }));
vi.mock("./search-inbox", () => ({
  searchInboxSession: () => ({}),
  isSearchInboxSession: () => true,
}));
vi.mock("./native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => true,
  useNavigation: () => ({ isFocused: () => true }),
  useLocalSearchParams: () => ({ spaceId: "target", status: "mcp_missing" }),
  useRouter: () => ({ push: state.push }),
}));
vi.mock("../components/sheet-header", () => ({ cancelHeaderOptions: () => ({}) }));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ActivityIndicator: () => <span>Loading</span>,
}));
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingsRow: ({
    title,
    detail,
    onPress,
    disabled,
  }: {
    title: string;
    detail?: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {title}
      {detail}
    </button>
  ),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  queryClient.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.data = {
    client: { id: "client", name: "Example" },
    setupBotIds: ["canonical-pm"],
    buildings: [],
  };
  state.error = null;
  state.setup.mockResolvedValue({ status: "ready" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<ClientSetupScreen />));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.startsWith(text),
  )!;
  await act(async () => button.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
it("resumes the canonical client's setup and opens its assigned PM", async () => {
  await mount();
  expect(container.textContent).toContain("Connect your setup tools");
  await click("Retry setup");
  expect(state.setup).toHaveBeenCalledWith("Example", "target");
  expect(container.textContent).not.toContain("Connect your setup tools");
  await click("Open PM");
  expect(state.push).toHaveBeenCalledWith({
    pathname: "/thread",
    params: { botId: "canonical-pm", name: "PM" },
  });
});
it("keeps archive recovery reachable when the hierarchy service fails", async () => {
  state.data = null;
  state.error = new Error("Client setup unavailable");
  await mount();
  expect(container.textContent).toContain("Client setup unavailable");
  await click("Archived chats");
  expect(state.push).toHaveBeenCalledWith("/archived-bots");
  await click("Retry");
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.setup).not.toHaveBeenCalled();
});
it("does not offer a replacement setup PM when all assignments are archived", async () => {
  state.data = { client: { id: "client", name: "Example" }, setupBotIds: [], buildings: [] };
  await mount();
  expect(container.textContent).not.toContain("Open PM");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Archived chats",
  ]);
  expect(state.setup).not.toHaveBeenCalled();
});
