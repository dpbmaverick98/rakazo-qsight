import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("artifact stage switches history and closes", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/artifact-stage.html");
  await expect(page.getByText("Project brief", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "artifact-stage");
  await page.getByRole("button", { name: "Artifact history" }).click();
  await page.getByRole("menuitem", { name: "Project summary" }).click();
  await expect(page.getByText("This artifact isn't supported yet.")).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByRole("region", { name: "Artifact stage" })).toHaveCount(0);
});
