import { expect, test } from "@playwright/test";
import { commercialFixture } from "@rakazo/contracts/project-commercial-fixture";
import { captureScreenshot, completeOnboarding, openBotPanelTab, rpc, signup } from "./helpers";

test("client hierarchy shares the right region with chat details", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signup(page, `hierarchy-${Date.now()}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page);
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  const createdProjects: { id: string; name: string; url: string }[] = [];
  const candidate = {
    address: "10 Example Street",
    latitude: 51.505,
    longitude: -0.09,
    attribution: "Synthetic map attribution",
    selectable: true,
    verification_token: "fake-candidate",
  };
  // Keep the map journey deterministic and offline.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/agent-plane/projects", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ buildingId: "north", name: "Window survey" });
    const project = {
      id: "windows",
      name: "Window survey",
      url: "https://hierarchy.example.test/projects/windows",
    };
    createdProjects.push(project);
    await route.fulfill({
      status: 201,
      json: { ...project, currency: "GBP", building_id: "north" },
    });
  });
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
            address: candidate.address,
            latitude: 51.505,
            longitude: -0.09,
            projects: [
              ...createdProjects,
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
  const building = rail
    .getByRole("button", { name: "North Building", exact: true })
    .and(rail.locator("[aria-expanded]"));
  await expect(rail).toBeVisible();
  await expect(rail.getByText("Workspace artifacts", { exact: true })).toBeVisible();
  await expect(rail.getByText(candidate.address, { exact: true })).toBeVisible();
  await expect(rail.getByText("Drywall", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "live-hierarchy-stage");
  await expect(rail.getByRole("region", { name: "Building map" })).toBeVisible();
  await rail.locator(".leaflet-marker-icon").click();
  await expect(building).toHaveAttribute("aria-expanded", "true");
  const composer = page.getByTestId("composer-field").locator("textarea");
  await expect(rail.getByRole("button", { name: "Add building", exact: true })).toHaveCount(0);
  await rail.getByRole("button", { name: "Add project", exact: true }).click();
  const projectForm = rail.getByRole("form", { name: "Add project", exact: true });
  await expect(projectForm.getByRole("textbox", { name: "Project name" })).toBeFocused();
  await captureScreenshot(page, testInfo, "add-project-form");
  await projectForm.getByRole("textbox", { name: "Project name" }).fill("Window survey");
  await projectForm.getByRole("button", { name: "Create", exact: true }).click();
  await expect(rail.getByRole("button", { name: "Window survey", exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  await captureScreenshot(page, testInfo, "add-project-created");
  await rail.getByRole("button", { name: "Roof survey", exact: true }).click();
  const commercial = rail.getByRole("region", { name: "Commercial", exact: true });
  await expect(commercial.getByRole("heading", { name: "Roof survey" })).toBeVisible();
  await commercial.getByRole("button", { name: "Create project manager", exact: true }).click();
  await expect(commercial.getByRole("alert")).toHaveText(
    "Could not create project manager. Try again.",
  );
  await expect(commercial.getByRole("button", { name: "Create project manager" })).toBeEnabled();
  const managersResponse = await page.request.post("/rpc/bots/list", {
    headers: { "x-rakazo-space-id": space.id },
    data: { json: {} },
  });
  expect(managersResponse.ok()).toBeTruthy();
  const { json: managers } = (await managersResponse.json()) as { json: { name: string }[] };
  expect(managers.filter((item) => item.name === "Proj. Manager - Sam")).toHaveLength(0);
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
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(rail).toBeVisible();
  await rail.getByRole("button", { name: "Roof survey", exact: true }).click();
  await rail.getByRole("button", { name: "Finishes", exact: true }).click();
  await rail.getByRole("button", { name: "Example Interiors", exact: true }).click();
  await captureScreenshot(page, testInfo, "project-commercial-narrow");
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ status: 503 }));
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().startsWith("https://tile.openstreetmap.org/") && response.status() === 503,
    ),
    page.reload(),
  ]);
  await expect(rail.getByRole("button", { name: "North Building", exact: true })).toBeVisible();
  await expect(rail.getByRole("region", { name: "Building map" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "Roof survey", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "hierarchy-map-fallback");
});
