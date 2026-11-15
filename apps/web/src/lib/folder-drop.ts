import { ATTACHMENT_COUNT_CEILING } from "@rakazo/contracts";

/** Read directory batches until exhausted; browsers commonly return only 100 entries per batch. */
export async function droppedAttachmentFiles(data: DataTransfer): Promise<File[]> {
  // Capture entries before yielding: the browser clears the drag data after the event returns.
  const entries = Array.from(data.items ?? []).map((item) => item.webkitGetAsEntry?.());
  if (!entries.some(Boolean)) return Array.from(data.files);
  const files: File[] = [];
  async function visit(entry: FileSystemEntry, parent = ""): Promise<void> {
    if (files.length > ATTACHMENT_COUNT_CEILING) return;
    const relativePath = `${parent}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      if (parent) Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (files.length <= ATTACHMENT_COUNT_CEILING) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${relativePath}/`);
      }
    }
  }
  for (const entry of entries) if (entry) await visit(entry);
  return files;
}
