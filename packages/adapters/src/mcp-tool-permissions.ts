/** The same assignment policy applies to ordinary MCP calls and protocol bridges. */
export function mcpToolAllowed(
  assignment: { allowAllTools: boolean; allowedTools: unknown },
  tool: string,
): boolean {
  return (
    assignment.allowAllTools ||
    (Array.isArray(assignment.allowedTools) && assignment.allowedTools.includes(tool))
  );
}

/** Approval trust never expands the tools an assignment can execute. */
export function mcpToolTrusted(
  assignment: { allowAllTools: boolean; allowedTools: unknown; trustedTools?: unknown },
  tool: string,
): boolean {
  return (
    mcpToolAllowed(assignment, tool) &&
    Array.isArray(assignment.trustedTools) &&
    assignment.trustedTools.includes(tool)
  );
}
