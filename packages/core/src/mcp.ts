import { newClientId } from "./client-id.js";
export function deriveMcpSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[_-]+|-+$/g, "")
      .slice(0, 64) || `mcp-${Date.now()}`
  );
}

export function customMcpServerInput(name: string, endpoint: string) {
  return {
    slug: `integration-${newClientId().slice(0, 8)}`,
    name: name.trim(),
    transport: "streamable_http" as const,
    endpoint: endpoint.trim(),
  };
}

/** Business labels depend on the protocol action, never a provider id. */
const mcpActions: Record<string, string> = {
  create_client: "Create client",
  create_building: "Create building",
  create_project: "Create project",
  create_work_package: "Create work package",
  search_locations: "Check address",
  get_location_proof: "Confirm address",
  search_documents: "Search documents",
  get_document_evidence: "Read document evidence",
  search_clients: "Search clients",
  list_documents: "Look up documents",
  get_work_package: "Read work package",
  list_clients: "Look up clients",
  list_buildings: "Look up buildings",
  list_projects: "Look up projects",
  list_work_packages: "Look up work packages",
  get_client: "Read client",
  get_building: "Read building",
  get_project: "Read project",
  get_project_summary: "Read project summary",
  get_intake: "Read staged intake",
  get_claim_position: "Read claim position",
  list_issues: "Look up issues",
  get_invoice_register: "Read invoice register",
  preview_change_order: "Preview change order",
  get_hierarchy: "Read client hierarchy",
  get_document: "Read document",
  publish_documents: "Publish documents",
  approve_documents: "Approve documents",
  delete_document: "Delete document",
};

export function friendlyMcpToolLabel(tool: string): string {
  const legacy = tool.match(/^mcp\s+\S+\s+(.+)$/i);
  const action = tool.startsWith("mcp__")
    ? tool.split("__").slice(2).join("__")
    : legacy
      ? legacy[1]!.replace(/ /g, "_")
      : tool.split(" ").at(-1)!;
  return mcpActions[action] ?? (tool.startsWith("mcp__") || legacy ? "Use connected tool" : tool);
}

/** Stable business labels shared by new approvals and legacy card rendering. */
export function mcpApprovalTitle(tool: string): string | undefined {
  if (!tool.startsWith("mcp__")) return undefined;
  const label = friendlyMcpToolLabel(tool);
  return label === "Use connected tool" ? "Allow action?" : `${label}?`;
}
