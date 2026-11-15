import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("MCP approval asks a business question without exposing arguments", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/mcp-tool-approval.html");
  await expect(page.getByText("Create building?", { exact: true })).toBeVisible();
  await expect(page.getByText("Example Client · North Tower", { exact: true })).toBeVisible();
  for (const name of ["Allow once", "Always allow this action", "Deny"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/fake-|verification_token|client_id|mcp__/);
  await captureScreenshot(page, testInfo, "mcp-tool-approval");
  await page.setViewportSize({ width: 400, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  await captureScreenshot(page, testInfo, "mcp-tool-approval-narrow");
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(page.getByText("Allowed once", { exact: true })).toBeVisible();
});
