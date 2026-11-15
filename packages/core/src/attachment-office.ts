import { unzipSync } from "fflate";
import { AttachmentValidationError } from "./attachments.js";

/** Inspect Office containers without decompressing entries or executing document content. */
export function validateOfficeAttachment(name: string, mimeType: string, bytes: Uint8Array): void {
  const formats: Record<string, { type: string; entry?: string }> = {
    doc: { type: "application/msword" },
    docx: {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      entry: "word/document.xml",
    },
    ppt: { type: "application/vnd.ms-powerpoint" },
    pptx: {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      entry: "ppt/presentation.xml",
    },
  };
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const format = formats[extension];
  if (!format && !Object.values(formats).some((item) => item.type === mimeType)) return;
  const invalid = () =>
    new AttachmentValidationError("Office document extension, type and content must match");
  if (!format || format.type !== mimeType) throw invalid();
  if (!format.entry) {
    if (
      ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
        (byte, index) => bytes[index] === byte,
      )
    )
      throw invalid();
    return;
  }
  const entries = new Set<string>();
  try {
    unzipSync(bytes, {
      filter: (entry) => {
        entries.add(entry.name);
        return false;
      },
    });
  } catch {
    throw invalid();
  }
  if (!entries.has("[Content_Types].xml") || !entries.has(format.entry)) throw invalid();
}
