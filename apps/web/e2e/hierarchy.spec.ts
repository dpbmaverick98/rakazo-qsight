import { expect, test } from "@playwright/test";
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { captureScreenshot, completeOnboarding, openBotPanelTab, rpc, signup } from "./helpers";

test("PM project tabs share one right-panel controller", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signup(page, `hierarchy-${Date.now()}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page);
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  const candidate = {
    address: "10 Example Street",
    latitude: 51.505,
    longitude: -0.09,
    attribution: "Synthetic map attribution",
    selectable: true,
    verification_token: "fake-candidate",
  };
  // External map failures must preserve project navigation.
  await page.route("https://maps.geoapify.com/**", (route) => route.abort());
  await page.route("**/api/agent-plane/hierarchy", async (route) => {
    if (route.request().headers()["x-rakazo-space-id"] !== space.id)
      return route.fulfill({ status: 204 });
    await route.fulfill({
      json: {
        bindingRevision: 1,
        client: { id: "example", name: "Example Client" },
        buildings: [
          {
            id: "north",
            name: "North Building",
            address: candidate.address,
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
  await page.route("**/api/agent-plane/navigation", (route) =>
    route.request().headers()["x-rakazo-space-id"] === space.id
      ? route.fulfill({
          json: {
            spaceId: space.id,
            bindingRevision: 1,
            client: { id: "example", name: "Example Client" },
            setupBotIds: [],
            buildings: [
              {
                id: "north",
                name: "North Building",
                projects: [{ id: "roof", name: "Roof survey", botIds: [bot.id] }],
              },
            ],
          },
        })
      : route.fulfill({ status: 204 }),
  );
  await page.goto(`/app/${bot.id}`);
  const tabs = page.getByRole("tablist", { name: "Project views" });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("heading", { name: "Example Client", exact: true })).toBeVisible();
  await expect(page.getByText("North Building", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Roof survey", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText("Map unavailable", { exact: true })).toBeVisible();
  const sidebarBuilding = page.getByRole("heading", { name: "North Building", exact: true });
  await expect(sidebarBuilding).toBeVisible();
  await expect(sidebarBuilding.locator("button")).toHaveCount(0);
  await expect(page.locator(`[data-roster-bot-id="${bot.id}"]`)).toContainText("Roof survey - PM");
  await captureScreenshot(page, testInfo, "project-space");
  await page.getByRole("button", { name: "Finishes", exact: true }).click();
  const commercial = page.getByRole("region", { name: "Commercial", exact: true });
  await expect(tabs.getByRole("tab", { name: "Claims", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await commercial.getByRole("button", { name: "Finishes", exact: true }).click();
  await commercial.getByRole("button", { name: "Example Interiors", exact: true }).click();
  await expect(commercial.getByText("Drywall", { exact: true })).toBeVisible();
  await expect(commercial.locator("input,textarea,form")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "project-claims");
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Claims", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await openBotPanelTab(page, "Computer");
  await expect(tabs).toHaveCount(0);
  await expect(page.getByTestId("bot-settings")).toBeVisible();
  await page.getByRole("button", { name: "Project space", exact: true }).click();
  await expect(tabs.getByRole("tab", { name: "Claims", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(tabs).toBeVisible();
  await captureScreenshot(page, testInfo, "project-claims-narrow");
  await tabs.getByRole("tab", { name: "Project space", exact: true }).click();
  await captureScreenshot(page, testInfo, "project-space-narrow");
});
