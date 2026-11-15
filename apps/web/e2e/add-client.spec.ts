import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("Add client saves a PM, resumes missing tools and opens its chat directly", async ({
  page,
}, testInfo) => {
  await signup(page, `client-setup-${Date.now()}@rakazo.test`, "password12", "Test User");
  await completeOnboarding(page);
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  const botResponse = await page.request.post("/rpc/bots/create", {
    headers: { "x-rakazo-space-id": space.id },
    data: { json: { name: "PM", description: "", notifyOnFinish: false, computerMode: "team" } },
  });
  expect(botResponse.ok()).toBeTruthy();
  const { json: bot } = (await botResponse.json()) as { json: { id: string } };
  let attempts = 0;
  await page.route("**/api/agent-plane/clients", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ name: "Example Client" });
    attempts++;
    await route.fulfill({
      json: {
        clientId: "client",
        spaceId: space.id,
        botId: bot.id,
        serverId: attempts === 1 ? null : "tools",
        status: attempts === 1 ? "mcp_missing" : "ready",
      },
    });
  });
  await page.goto("/app");
  await page.getByTestId("create-menu-trigger").click();
  await page.getByRole("option", { name: "Add client", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add client", exact: true });
  const input = dialog.getByRole("textbox", { name: "Client name", exact: true });
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await input.fill("Example Client");
  await captureScreenshot(page, testInfo, "add-client-form");
  await dialog.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("PM saved.");
  await captureScreenshot(page, testInfo, "add-client-resume");
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${bot.id}$`));
  await expect(dialog).not.toBeVisible();
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("rakazo:space-id"))).toBe(space.id);
  await captureScreenshot(page, testInfo, "add-client-pm");
});
