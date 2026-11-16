import { expect, test } from "@playwright/test";
import { captureScreenshot, rpc, signup } from "./helpers";

test("bare app leaves an empty default Space for a client PM", async ({ page }, testInfo) => {
  await signup(page, `app-client-${Date.now()}@rakazo.test`, "password12", "Test User");
  await expect(page.getByRole("heading", { name: "Start with a client" })).toBeVisible();
  const defaultBots = await rpc<{ id: string }[]>(page, "bots/list", {});
  const space = await rpc<{ id: string }>(page, "spaces/create", { name: "Example Client" });
  const response = await page.request.post("/rpc/bots/create", {
    headers: { "x-rakazo-space-id": space.id },
    data: { json: { name: "PM", description: "", notifyOnFinish: false, computerMode: "team" } },
  });
  expect(response.ok()).toBeTruthy();
  const { json: bot } = (await response.json()) as { json: { id: string } };
  for (const bot of defaultBots) await rpc(page, "bots/remove", { botId: bot.id });
  await page.evaluate(() => localStorage.removeItem("rakazo:space-id"));
  await page.goto("/app");
  await expect(page).toHaveURL(new RegExp(`/app/${bot.id}$`));
  await expect(page.getByRole("combobox", { name: /^Message PM/ }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rakazo:space-id"))).toBe(space.id);
  await captureScreenshot(page, testInfo, "app-client-pm-landing");
});

test("bare app with no clients keeps the client landing", async ({ page }, testInfo) => {
  await signup(page, `app-no-client-${Date.now()}@rakazo.test`, "password12", "Test User");
  await expect(page.getByRole("heading", { name: "Start with a client" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("rakazo:space-id"));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Start with a client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create client", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await captureScreenshot(page, testInfo, "app-no-client-landing");
});
