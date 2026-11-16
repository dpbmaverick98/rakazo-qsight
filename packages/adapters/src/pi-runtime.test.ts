import type { ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  agentToolDefinitions,
  connectorStepNames,
  describeToolActivity,
  redactAskUserDetailInMessage,
} from "./pi-runtime-tools.js";

describe("connector tool labels", () => {
  const search: ConnectorTool = {
    name: "VENDOR_SEARCH_TOOLS",
    label: "Finding tools",
    description: "",
    inputSchema: {},
  };
  const batch: ConnectorTool = {
    name: "VENDOR_MULTI_EXECUTE",
    label: "Running tools",
    description: "",
    inputSchema: {},
    batch: { items: "tools", action: "tool_slug", arguments: "arguments" },
  };
  const tools = new Map([search, batch].map((tool) => [tool.name, tool]));
  const args = { tools: [{ tool_slug: "POSTIZ_LIST_POSTS", arguments: {} }] };

  it("finds a tool under the name the model calls it", () => {
    const renamed: ConnectorTool = { ...search, name: "VENDOR SEARCH" };
    const byAgentName = agentToolDefinitions([renamed]);
    expect(describeToolActivity("VENDOR_SEARCH", {}, (name) => byAgentName.get(name))).toBe(
      "Finding tools",
    );
  });

  it("shows a label or the actions a batch runs instead of the model's tool name", () => {
    expect(describeToolActivity(search.name, { queries: [] }, (name) => tools.get(name))).toBe(
      "Finding tools",
    );
    expect(describeToolActivity(batch.name, args, (name) => tools.get(name))).toBe(
      "Using Postiz list posts",
    );
    expect(connectorStepNames(search, {})).toEqual(["Finding tools"]);
    expect(connectorStepNames(batch, args)).toEqual(["Postiz list posts"]);
    expect(connectorStepNames(batch, {})).toEqual(["Running tools"]);
    const many = { tools: ["A", "B", "C", "D"].map((tool_slug) => ({ tool_slug })) };
    expect(connectorStepNames(batch, many)).toEqual(["Running tools"]);
    const partial = { tools: [{ tool_slug: "POSTIZ_LIST_POSTS" }, {}] };
    expect(connectorStepNames(batch, partial)).toEqual(["Running tools"]);
    const odd = { tools: [{ tool_slug: "list posts --token=abc" }] };
    expect(connectorStepNames(batch, odd)).toEqual(["Running tools"]);
    expect(describeToolActivity(batch.name, odd, (name) => tools.get(name))).toBe("Running tools");
    expect(connectorStepNames(undefined, {})).toEqual([]);
  });
});

describe("describeToolActivity", () => {
  it("summarizes builtin tools with their most informative argument", () => {
    expect(describeToolActivity("shell", { command: "pnpm test --filter web" })).toBe(
      "Running: pnpm test --filter web",
    );
    expect(describeToolActivity("read_file", { path: "notes/plan.md" })).toBe(
      "Reading notes/plan.md",
    );
    expect(describeToolActivity("write_file", { path: "out.csv", content: "…" })).toBe(
      "Writing out.csv",
    );
    expect(describeToolActivity("list_fleet", {})).toBe("Checking your bots");
    expect(describeToolActivity("render_plot", { spec: {} })).toBe("Rendering a chart");
    expect(describeToolActivity("save_page", { help: true })).toBe(
      "Reading the page kit reference",
    );
    expect(describeToolActivity("save_page", { title: "Plan", source: "x" })).toBe(
      "Writing the page code",
    );
    expect(describeToolActivity("add_mcp_server", { name: "Linear" })).toBe(
      "Connecting MCP server: Linear",
    );
    expect(describeToolActivity("run_subagent", { name: "scout", task: "…" })).toBe(
      "Delegating to helper: scout",
    );
    expect(describeToolActivity("create_space", { name: "Customer support" })).toBe(
      "Creating space: Customer support",
    );
    expect(describeToolActivity("web_search", { query: "rakazo agents" })).toBe(
      "Searching the web: rakazo agents",
    );
    expect(describeToolActivity("web_fetch", { url: "https://example.com" })).toBe(
      "Reading page: https://example.com/",
    );
  });

  it.each([
    ["search_locations", "Checking address"],
    ["get_location_proof", "Confirming address"],
    ["search_documents", "Checking documents"],
    ["get_document_evidence", "Reading document evidence"],
    ["list_clients", "Looking up clients"],
    ["list_buildings", "Looking up buildings"],
    ["list_projects", "Looking up projects"],
    ["create_client", "Creating client"],
    ["create_building", "Creating building"],
    ["create_project", "Creating project"],
    ["create_work_package", "Creating work package"],
    ["get_project", "Reading project"],
    ["list_work_packages", "Looking up work packages"],
    ["rename_project", "Renaming project"],
    ["delete_project", "Deleting project"],
    ["unknown_action", "Using connected tool"],
  ])("describes MCP action %s without exposing internals", (action, expected) => {
    const line = describeToolActivity(`mcp__vendor-one-pilot__${action}`, {});
    expect(line).toBe(expected);
    expect(line).not.toContain("mcp__");
    expect(line).not.toContain("vendor-one-pilot");
    expect(line).not.toContain(action);
  });

  it("uses the same labels and fallback for other MCP servers", () => {
    expect(describeToolActivity("mcp__demo-oauth__search_locations", {})).toBe("Checking address");
    expect(describeToolActivity("mcp__demo-oauth__greet", {})).toBe("Using connected tool");
  });

  it("truncates long details and collapses whitespace", () => {
    const long = `x${"y".repeat(200)}`;
    const line = describeToolActivity("shell", { command: `a\n\t${long}` });
    expect(line.length).toBeLessThanOrEqual("Running: ".length + 91);
    expect(line).toContain("…");
    expect(line).not.toContain("\n");
    expect(line).toMatch(/^Running: a x/);
  });

  it("redacts credentials from activity details", () => {
    const token = "fake-token";
    const line = describeToolActivity("shell", {
      command: `curl -H 'Authorization: Bearer ${token}' https://example.test?api_key=fake-key password=fake-password`,
    });

    expect(line).toContain("Bearer [redacted]");
    expect(line).toContain("api_key=[redacted]");
    expect(line).not.toContain(token);
    expect(line).not.toContain("fake-key");
    expect(line).not.toContain("fake-password");
  });

  it("strips signed-URL query and fragment from web_fetch activity", () => {
    const line = describeToolActivity("web_fetch", {
      url: "https://user:secret@cdn.example.test/doc.pdf?X-Amz-Signature=abc123&token=leak#frag",
    });
    expect(line).toBe("Reading page: https://cdn.example.test/doc.pdf");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("X-Amz-Signature");
    expect(line).not.toContain("token=");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("frag");
  });

  it("does not echo secrets from malformed web_fetch URLs", () => {
    const line = describeToolActivity("web_fetch", {
      url: "https://user:secret@[",
    });
    expect(line).toBe("Reading page: [invalid URL]");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("user:");
  });

  it("falls back to the tool name", () => {
    expect(describeToolActivity("destination_write", undefined)).toBe("Using destination_write");
  });
});

describe("redactAskUserDetailInMessage", () => {
  it("leaves malformed ask_user arguments for argument preparation to reject", () => {
    const content = [
      { type: "toolCall", name: "ask_user", arguments: "detail" },
      { type: "toolCall", name: "ask_user", arguments: 7 },
      { type: "toolCall", name: "use_tool", arguments: { name: "ask_user", arguments: "detail" } },
      { type: "toolCall", name: "ask_user", arguments: { detail: "token sk-test-1" } },
    ];
    expect(() =>
      redactAskUserDetailInMessage({ role: "assistant", content }, ["sk-test-1"]),
    ).not.toThrow();
    expect(content.map((part) => part.arguments)).toEqual([
      "detail",
      7,
      { name: "ask_user", arguments: "detail" },
      { detail: "token [redacted]" },
    ]);
  });

  it("redacts secrets in ask_user arguments a use_tool wrapper carries as a bare string", () => {
    const content = [
      {
        type: "toolCall",
        name: "use_tool",
        arguments: { name: "ask_user", arguments: "send sk-test-1?" },
      },
    ];
    redactAskUserDetailInMessage({ role: "assistant", content }, ["sk-test-1"]);
    expect(content.map((part) => part.arguments)).toEqual([
      { name: "ask_user", arguments: "send [redacted]?" },
    ]);
  });
});
