import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validateOfficeAttachment } from "./attachment-office.js";
import { attachmentComputerPath, inferAttachmentMimeType } from "./attachments.js";

const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docx = zipSync({
  "[Content_Types].xml": strToU8("<Types/>"),
  "word/document.xml": strToU8("<document/>"),
});
describe("Office uploads", () => {
  it("infers DOCX without a browser MIME and preserves the tool extension", () => {
    expect(inferAttachmentMimeType("claims/proposal.DOCX", "application/octet-stream")).toBe(type);
    expect(attachmentComputerPath("file-id", type)).toBe("attachments/file-id.docx");
    expect(() => validateOfficeAttachment("claims/proposal.docx", type, docx)).not.toThrow();
  });
  it("rejects renamed files, mismatched MIME, truncated ZIPs and other ZIP containers", () => {
    for (const bytes of [
      strToU8("executable"),
      docx.slice(0, 20),
      zipSync({ "invoice.txt": strToU8("text") }),
    ]) {
      expect(() => validateOfficeAttachment("proposal.docx", type, bytes)).toThrow("must match");
    }
    expect(() => validateOfficeAttachment("proposal.exe", type, docx)).toThrow();
    expect(() => validateOfficeAttachment("proposal.docx", "application/zip", docx)).toThrow();
  });
  it("keeps existing image and PDF validation unchanged", () => {
    expect(() =>
      validateOfficeAttachment("photo.png", "image/png", new Uint8Array()),
    ).not.toThrow();
    expect(() =>
      validateOfficeAttachment("invoice.pdf", "application/pdf", new Uint8Array()),
    ).not.toThrow();
  });
});

it("accepts legacy Office signatures and a presentation container", () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(() => validateOfficeAttachment("proposal.doc", "application/msword", ole)).not.toThrow();
  expect(() =>
    validateOfficeAttachment("slides.ppt", "application/vnd.ms-powerpoint", ole),
  ).not.toThrow();
  const pptx = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "ppt/presentation.xml": strToU8("<presentation/>"),
  });
  expect(() =>
    validateOfficeAttachment(
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      pptx,
    ),
  ).not.toThrow();
});
