import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Artifact, ArtifactWithContent } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("Excel files can be attached and uploaded without losing their bytes", async ({
  page,
}, testInfo) => {
  await signup(page, `spreadsheet-${Date.now()}@rakazo.test`, "password12", "Sheet Reader");
  await completeOnboarding(page);
  const composer = page.getByRole("combobox", { name: /Message/ });
  await expect(composer).toBeVisible();
  const files = [
    { name: "statement.xls", mimeType: "application/octet-stream" },
    { name: "statement.xlsx", mimeType: "" },
  ].map((file) => ({
    ...file,
    buffer: readFileSync(path.join(import.meta.dirname, "fixtures", file.name)),
  }));
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(files);
  for (const file of files) {
    await expect(
      page.getByRole("button", { name: `Remove ${file.name}`, exact: true }),
    ).toBeVisible();
  }
  await captureScreenshot(page, testInfo, "excel-attachments-ready");
  await composer.fill("Here are the current statements");
  await composer.press("Enter");
  await expect(
    page.getByTestId("transcript").getByText("Here are the current statements", { exact: true }),
  ).toBeVisible();
  const artifacts = await rpc<Artifact[]>(page, "artifacts/list", { botId: activeBotId(page) });
  for (const [index, file] of files.entries()) {
    const artifact = artifacts.find((item) => item.name === file.name);
    expect(artifact).toBeDefined();
    expect(artifact?.mimeType).toBe(
      [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ][index],
    );
    const stored = await rpc<ArtifactWithContent>(page, "artifacts/getById", {
      artifactId: artifact!.id,
    });
    expect(stored.contentBase64).toBe(file.buffer.toString("base64"));
  }
});

test("a folder preserves document paths through chat upload", async ({ page }, testInfo) => {
  const temporary = mkdtempSync(path.join(tmpdir(), "chat-folder-"));
  const folder = path.join(temporary, "claims");
  mkdirSync(path.join(folder, "proposals"), { recursive: true });
  const document = readFileSync(path.join(import.meta.dirname, "fixtures", "proposal.docx"));
  writeFileSync(path.join(folder, "proposals", "proposal.docx"), document);
  writeFileSync(path.join(folder, "notes.txt"), "Example claim notes");
  try {
    await signup(page, `folder-${Date.now()}@rakazo.test`, "password12", "Document Reader");
    await completeOnboarding(page);
    await page.locator("input[webkitdirectory]").setInputFiles(folder);
    await expect(
      page.getByRole("button", { name: "Remove claims/proposals/proposal.docx", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove claims/notes.txt", exact: true }),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "folder-documents-ready");
    const composer = page.getByRole("combobox", { name: /Message/ });
    await composer.fill("Review these documents");
    await composer.press("Enter");
    await expect(
      page.getByTestId("transcript").getByText("Review these documents", { exact: true }),
    ).toBeVisible();
    const artifacts = await rpc<Artifact[]>(page, "artifacts/list", { botId: activeBotId(page) });
    const artifact = artifacts.find((item) => item.name === "claims/proposals/proposal.docx");
    expect(artifact?.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const stored = await rpc<ArtifactWithContent>(page, "artifacts/getById", {
      artifactId: artifact!.id,
    });
    expect(stored.contentBase64).toBe(document.toString("base64"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
