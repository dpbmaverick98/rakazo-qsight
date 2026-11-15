import { PROJECT_MANAGER_TOOLS, projectManagerToolPolicy } from "@rakazo/core";
import { expect, it } from "vitest";
import { mcpToolAllowed, mcpToolTrusted } from "./mcp-tool-permissions.js";

const setup = {
  allowAllTools: false,
  allowedTools: [...PROJECT_MANAGER_TOOLS.trustedTools, ...PROJECT_MANAGER_TOOLS.setupWriteTools],
  trustedTools: PROJECT_MANAGER_TOOLS.trustedTools,
};

it("trusts only configured preparation and read tools", () => {
  for (const tool of PROJECT_MANAGER_TOOLS.trustedTools) {
    expect(mcpToolAllowed(setup, tool)).toBe(true);
    expect(mcpToolTrusted(setup, tool)).toBe(true);
  }
});

it("offers setup writes without trusting them, and denies unknown and destructive tools", () => {
  for (const tool of PROJECT_MANAGER_TOOLS.setupWriteTools) {
    expect(mcpToolAllowed(setup, tool)).toBe(true);
    expect(mcpToolTrusted(setup, tool)).toBe(false);
  }
  for (const tool of ["unknown", "delete_document", "publish_documents", "approve_documents"]) {
    expect(mcpToolAllowed(setup, tool)).toBe(false);
    expect(mcpToolTrusted({ ...setup, trustedTools: [tool] }, tool)).toBe(false);
  }
});

it("supports explicit trust for a write without granting another write", () => {
  const assignment = { ...setup, trustedTools: ["create_project"] };
  expect(mcpToolTrusted(assignment, "create_project")).toBe(true);
  expect(mcpToolTrusted(assignment, "create_building")).toBe(false);
  expect(mcpToolTrusted({ ...setup, trustedTools: null }, "search_clients")).toBe(false);
});

it("preserves explicit writes across provisioning without admitting new tools", () => {
  const policy = projectManagerToolPolicy(["create_project", "unknown"]);
  expect(mcpToolTrusted(policy, "create_project")).toBe(true);
  expect(mcpToolTrusted(policy, "search_clients")).toBe(true);
  expect(mcpToolAllowed(policy, "unknown")).toBe(false);
  expect(policy.trustedTools).not.toContain("unknown");
});
