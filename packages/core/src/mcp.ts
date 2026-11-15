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

/** Stable business labels shared by new approvals and legacy card rendering. */
export function mcpApprovalTitle(tool: string): string | undefined {
  if (!tool.startsWith("mcp__")) return undefined;
  const action = tool.split("__").slice(2).join("__");
  const titles: Record<string, string> = {
    create_client: "Create client?",
    create_building: "Create building?",
    create_project: "Create project?",
    create_work_package: "Create work package?",
    publish_documents: "Publish documents?",
    approve_documents: "Approve documents?",
    delete_document: "Delete document?",
  };
  return titles[action] ?? "Allow action?";
}
