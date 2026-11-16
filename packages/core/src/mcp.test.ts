import { McpServerConfigInput } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendToolStep } from "./events.js";
import { deriveMcpSlug, friendlyMcpToolLabel, mcpApprovalTitle } from "./mcp.js";
import { PROJECT_MANAGER_TOOLS } from "./plugin-catalog.js";

afterEach(() => vi.restoreAllMocks());

describe("deriveMcpSlug", () => {
  it.each([
    ["!_-_LOCAL!", "local"],
    [`${"_".repeat(80)}local`, "local"],
    ["9 Local", "9-local"],
    ["Local_MCP_", "local_mcp_"],
    ["Brex MCP Server!", "brex-mcp-server"],
    ["x".repeat(100), "x".repeat(64)],
  ])("derives a backend-valid slug for %j", (name, expected) => {
    const slug = deriveMcpSlug(name);

    expect(slug).toBe(expected);
    expect(
      McpServerConfigInput.safeParse({
        name: "Synthetic MCP server",
        slug,
        transport: "stdio",
        command: "demo",
      }).success,
    ).toBe(true);
  });

  it.each(["", "-_!-_", "世界"])(
    "uses a backend-valid fallback when %j has no slug characters",
    (name) => {
      vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      const slug = deriveMcpSlug(name);

      expect(slug).toBe("mcp-1700000000000");
      expect(
        McpServerConfigInput.safeParse({
          name: "Synthetic MCP server",
          slug,
          transport: "stdio",
          command: "demo",
        }).success,
      ).toBe(true);
    },
  );

  it("preserves normalization collisions for the existing duplicate-server handling", () => {
    expect(deriveMcpSlug(" Local MCP ")).toBe(deriveMcpSlug("Local MCP!"));
  });
});

it.each([
  ["create_client", "Create client"],
  ["create_building", "Create building"],
  ["create_project", "Create project"],
  ["create_work_package", "Create work package"],
  ["search_locations", "Check address"],
  ["get_location_proof", "Confirm address"],
  ["search_documents", "Search documents"],
  ["get_document_evidence", "Read document evidence"],
  ["list_clients", "Look up clients"],
  ["list_buildings", "Look up buildings"],
  ["list_projects", "Look up projects"],
  ["get_project", "Read project"],
  ["get_project_summary", "Read project summary"],
  ["get_claim_position", "Read claim position"],
  ["list_issues", "Look up issues"],
  ["get_invoice_register", "Read invoice register"],
  ["preview_change_order", "Preview change order"],
])("labels saved and new %s calls without exposing the server name", (action, label) => {
  for (const tool of [
    action,
    `mcp__example-pilot__${action}`,
    `mcp__other__${action}`,
    `Mcp example-pilot ${action.replace(/_/g, " ")}`,
    `Example ${action}`,
  ]) {
    expect(friendlyMcpToolLabel(tool)).toBe(label);
    if (tool.startsWith("mcp__")) expect(mcpApprovalTitle(tool)).toBe(`${label}?`);
  }
});
it("keeps unknown protocol actions safe and preserves authored business labels", () => {
  expect(friendlyMcpToolLabel("mcp__example__future_action")).toBe("Use connected tool");
  expect(mcpApprovalTitle("mcp__example__future_action")).toBe("Allow action?");
  expect(friendlyMcpToolLabel("Checking documents")).toBe("Checking documents");
});

it("covers every catalog tool in shared step projection", () => {
  for (const action of [
    ...PROJECT_MANAGER_TOOLS.trustedTools,
    ...PROJECT_MANAGER_TOOLS.setupWriteTools,
  ]) {
    const tool = `mcp__example__${action}`;
    const label = friendlyMcpToolLabel(tool);
    expect(label).not.toBe("Use connected tool");
    expect(friendlyMcpToolLabel(action)).toBe(label);
    expect(appendToolStep([], tool)).toEqual([{ label, count: 1 }]);
  }
});

it("keeps review reads trusted and write-scope preparation separate", () => {
  expect(PROJECT_MANAGER_TOOLS.trustedTools).toEqual([
    "list_clients",
    "list_buildings",
    "list_projects",
    "list_work_packages",
    "get_project_summary",
    "get_claim_position",
    "list_issues",
    "search_documents",
    "get_document_evidence",
    "get_invoice_register",
    "preview_change_order",
  ]);
  expect(PROJECT_MANAGER_TOOLS.setupWriteTools).toEqual([
    "search_locations",
    "get_location_proof",
    "create_client",
    "create_building",
    "create_project",
    "create_work_package",
  ]);
  const catalog = [...PROJECT_MANAGER_TOOLS.trustedTools, ...PROJECT_MANAGER_TOOLS.setupWriteTools];
  expect(catalog).not.toContain("rename_project");
  expect(catalog).not.toContain("delete_project");
});
