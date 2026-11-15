// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { droppedAttachmentFiles } from "./folder-drop";
import { attachmentFileName } from "./pending-attachments";

function file(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    file: (done: (file: File) => void) => done(new File(["content"], name)),
  } as unknown as FileSystemEntry;
}
function directory(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  return {
    name,
    isDirectory: true,
    createReader: () => ({
      readEntries: (done: (entries: FileSystemEntry[]) => void) => done(batches.shift() ?? []),
    }),
  } as unknown as FileSystemEntry;
}
function data(entries: FileSystemEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
  } as unknown as DataTransfer;
}
describe("folder drops", () => {
  it("reads nested folders and all directory batches alongside loose files", async () => {
    const files = await droppedAttachmentFiles(
      data([
        directory("claims", [[file("invoice.docx")], [directory("photos", [[file("site.png")]])]]),
        file("notes.txt"),
      ]),
    );
    expect(files.map(attachmentFileName)).toEqual([
      "claims/invoice.docx",
      "claims/photos/site.png",
      "notes.txt",
    ]);
  });
  it("bounds traversal at the hard count ceiling plus one for the limit notice", async () => {
    const files = await droppedAttachmentFiles(
      data([directory("claims", [Array.from({ length: 200 }, (_, i) => file(`${i}.txt`))])]),
    );
    expect(files).toHaveLength(101);
  });
  it("reports directory read failures", async () => {
    const entry = {
      isDirectory: true,
      name: "unreadable",
      createReader: () => ({
        readEntries: (_done: unknown, fail: (error: Error) => void) => fail(new Error("denied")),
      }),
    } as unknown as FileSystemEntry;
    await expect(droppedAttachmentFiles(data([entry]))).rejects.toThrow("denied");
  });
  it("uses ordinary files when entry APIs are unavailable", async () => {
    const files = [new File(["hello"], "notes.txt")];
    expect(await droppedAttachmentFiles({ items: [], files } as unknown as DataTransfer)).toEqual(
      files,
    );
  });
});
