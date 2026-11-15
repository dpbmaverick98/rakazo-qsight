import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("client sidebar keeps PM scope, search context and reversible archive", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signup(page, `client-navigation-${Date.now()}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page);
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  await page.evaluate((id) => localStorage.setItem("rakazo:space-id", id), space.id);
  const createBot = async (input: { name: string; spawnKey?: string }) => {
    const response = await page.request.post("/rpc/bots/create", {
      headers: { "x-rakazo-space-id": space.id },
      data: {
        json: { ...input, title: "", description: "", notifyOnFinish: true, computerMode: "team" },
      },
    });
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as { json: { id: string } }).json;
  };
  const manager = await createBot({
    name: "Project manager",
    spawnKey: "pm:roof",
  });
  const legacy = await createBot({
    name: "Old assistant",
  });
  await page.route("**/api/agent-plane/navigation", (route) => {
    if (route.request().headers()["x-rakazo-space-id"] !== space.id)
      return route.fulfill({ status: 204 });
    return route.fulfill({
      json: {
        spaceId: space.id,
        bindingRevision: 1,
        client: { id: "client", name: "Example Client" },
        setupBotIds: [],
        buildings: [
          {
            id: "north",
            name: "North Building",
            projects: [{ id: "roof", name: "Roof survey", botIds: [manager.id] }],
          },
        ],
      },
    });
  });
  let releaseHierarchy = () => {};
  const hierarchyReady = new Promise<void>((resolve) => {
    releaseHierarchy = resolve;
  });
  await page.route("**/api/agent-plane/hierarchy", async (route) => {
    if (route.request().headers()["x-rakazo-space-id"] !== space.id)
      return route.fulfill({ status: 204 });
    await hierarchyReady;
    return route.fulfill({
      json: {
        canManage: true,
        bindingRevision: 1,
        client: { id: "client", name: "Example Client" },
        buildings: [
          {
            id: "north",
            name: "North Building",
            projects: [
              { id: "roof", name: "Roof survey", url: "https://example.test/projects/roof" },
            ],
          },
        ],
      },
    });
  });
  await page.goto(`/app/${manager.id}`);
  const sidebar = page.locator("aside").first();
  const building = sidebar.getByRole("button", { name: "Collapse North Building", exact: true });
  const project = sidebar.getByRole("button", { name: "Collapse Roof survey", exact: true });
  const pm = sidebar.locator(`[data-roster-bot-id="${manager.id}"]`);
  await expect(building).toBeVisible();
  await expect(project).toBeVisible();
  await expect(pm).toHaveCount(1);
  await expect(sidebar.locator(`[data-roster-bot-id="${legacy.id}"]`)).toHaveCount(0);
  await captureScreenshot(page, testInfo, "client-sidebar-grouped");
  await sidebar.getByRole("button", { name: "Actions for Example Client", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Add building", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete space", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "client-space-actions");
  await page.getByRole("menuitem", { name: "Add project", exact: true }).click();
  const addProject = page.getByRole("dialog", { name: "Add project", exact: true });
  await expect(addProject.getByRole("status")).toHaveText("Loading hierarchy…");
  releaseHierarchy();
  await expect(addProject.getByLabel("Building", { exact: true })).toHaveValue("north");
  await expect(addProject.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
  await expect(
    addProject.getByRole("textbox", { name: "Project name", exact: true }),
  ).toBeFocused();
  await captureScreenshot(page, testInfo, "client-space-add-project");
  await addProject.getByRole("button", { name: "Cancel", exact: true }).click();
  await sidebar.getByRole("button", { name: "Actions for Example Client", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add building", exact: true }).click();
  const addBuilding = page.getByRole("dialog", { name: "Add building", exact: true });
  await expect(
    addBuilding.getByRole("textbox", { name: "Address or site", exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "client-space-add-building");
  await addBuilding.getByRole("button", { name: "Cancel", exact: true }).click();

  await sidebar.getByRole("button", { name: "Actions for North Building", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Add building", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete space", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Add project", exact: true }).click();
  await expect(addProject.getByLabel("Building", { exact: true })).toHaveValue("north");
  await captureScreenshot(page, testInfo, "building-add-project");
  await addProject.getByRole("button", { name: "Cancel", exact: true }).click();

  await sidebar.getByRole("button", { name: "Actions for Roof survey", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Delete"]);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename project", exact: true });
  await expect(rename.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(
    "Roof survey",
  );
  await captureScreenshot(page, testInfo, "project-rename");
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await sidebar.getByRole("button", { name: "Actions for Roof survey", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Delete project", exact: true });
  await expect(remove).toContainText("work packages and documents");
  const confirm = remove.getByRole("button", { name: "Delete project", exact: true });
  await expect(confirm).toBeDisabled();
  await remove.getByRole("textbox").fill("roof survey");
  await expect(confirm).toBeDisabled();
  await remove.getByRole("textbox").fill("Roof survey ");
  await expect(confirm).toBeDisabled();
  await remove.getByRole("textbox").fill("Roof survey");
  await expect(confirm).toBeEnabled();
  await captureScreenshot(page, testInfo, "project-delete-confirmation");
  await remove.getByRole("button", { name: "Cancel", exact: true }).click();

  await building.click();
  await expect(pm).toHaveCount(0);
  await page.reload();
  await expect(
    sidebar.getByRole("button", { name: "Expand North Building", exact: true }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "Search", exact: true }).click();
  await sidebar.getByRole("textbox", { name: "Search", exact: true }).fill("Roof survey");
  await expect(project).toBeVisible();
  await expect(pm).toHaveCount(1);
  await captureScreenshot(page, testInfo, "client-sidebar-search-context");
  await sidebar.getByRole("textbox", { name: "Search", exact: true }).fill("");
  await expect(pm).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Expand North Building", exact: true }).click();
  await pm.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(pm).toHaveCount(0);
  await sidebar.getByRole("button", { name: /Archived/ }).click();
  const archived = sidebar.getByText("Project manager", { exact: true });
  await archived.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(
    sidebar.locator(`[data-sidebar-group$=":project:roof"] [data-roster-bot-id="${manager.id}"]`),
  ).toHaveCount(1);
});
