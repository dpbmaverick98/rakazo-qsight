import { expect, test } from "@playwright/test";
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { captureScreenshot, completeOnboarding, openBotPanelTab, rpc, signup } from "./helpers";

test("client hierarchy shares the right region with chat details", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signup(page, `hierarchy-${Date.now()}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page);
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  await page.route("**/api/agent-plane/hierarchy", async (route) => {
    if (route.request().headers()["x-rakazo-space-id"] !== space.id)
      return route.fulfill({ status: 204 });
    await route.fulfill({
      json: {
        client: { id: "example", name: "Example Client" },
        buildings: [
          {
            id: "north",
            name: "North Building",
            latitude: 51.505,
            longitude: -0.09,
            projects: [
              {
                id: "roof",
                name: "Roof survey",
                url: "https://hierarchy.example.test/projects/roof",
              },
            ],
          },
        ],
      },
    });
  });
  await page.route("**/api/agent-plane/projects/roof/commercial", (route) =>
    route.fulfill({ json: commercialFixture }),
  );
  await page.evaluate((id) => localStorage.setItem("rakazo:space-id", id), space.id);
  const botResponse = await page.request.post("/rpc/bots/create", {
    headers: { "x-rakazo-space-id": space.id },
    data: {
      json: {
        name: "Project assistant",
        title: "",
        description: "",
        notifyOnFinish: true,
        computerMode: "team",
      },
    },
  });
  expect(botResponse.ok()).toBeTruthy();
  const { json: bot } = (await botResponse.json()) as { json: { id: string } };
  await page.goto(`/app/${bot.id}`);
  const rail = page.getByRole("region", { name: "Client hierarchy" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("region", { name: "Building map" })).toBeVisible();
  await rail.locator(".leaflet-marker-icon").click();
  await expect(rail.getByRole("button", { name: "North Building", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(rail.getByRole("link", { name: "Roof survey (opens in new tab)" })).toBeVisible();
  await rail.getByRole("button", { name: "North Building" }).click();
  await rail.getByRole("button", { name: "Roof survey", exact: true }).click();
  const commercial = rail.getByRole("region", { name: "Commercial", exact: true });
  await expect(commercial.getByRole("heading", { name: "Roof survey" })).toBeVisible();
  await commercial.getByRole("button", { name: "Finishes", exact: true }).click();
  await commercial.getByRole("button", { name: "Example Interiors", exact: true }).click();
  await expect(commercial.getByText("Drywall", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "project-commercial");
  await commercial.getByRole("button", { name: "Back to hierarchy" }).click();

  await captureScreenshot(page, testInfo, "client-hierarchy-expanded");
  await openBotPanelTab(page, "Computer");
  await expect(rail).toBeVisible();
  await expect(page.getByTestId("bot-settings")).toBeVisible();
  await captureScreenshot(page, testInfo, "client-hierarchy-with-details");
  await rail.getByRole("button", { name: "Collapse hierarchy" }).click();
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await expect(rail).toBeVisible();
  await rail.getByRole("button", { name: "North Building", exact: true }).click();
  await rail.getByRole("button", { name: "Roof survey", exact: true }).click();
  await rail.getByRole("button", { name: "Finishes", exact: true }).click();
  await rail.getByRole("button", { name: "Example Interiors", exact: true }).click();
  await captureScreenshot(page, testInfo, "project-commercial-narrow");
});
