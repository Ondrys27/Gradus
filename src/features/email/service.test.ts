// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EmailError } from "./errors";

vi.mock("server-only", () => ({}));

const { bodyToHtml, isOwnEmailUploadPath, prepareAttachment } = await import("./service");

const USER = "8a3c7c43-9b0e-4d2a-9d3e-4f7b1c2d3e4f";
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("isOwnEmailUploadPath", () => {
  it("accepts only the user's own email folder with a uuid object name", () => {
    expect(isOwnEmailUploadPath(`${USER}/email/${crypto.randomUUID()}`, USER)).toBe(true);
    expect(isOwnEmailUploadPath(`${USER}/jarvis/${crypto.randomUUID()}`, USER)).toBe(false);
    expect(isOwnEmailUploadPath(`other-user/email/${crypto.randomUUID()}`, USER)).toBe(false);
    expect(isOwnEmailUploadPath(`${USER}/email/not-a-uuid`, USER)).toBe(false);
  });
});

describe("prepareAttachment", () => {
  it("base64-encodes a file whose content matches an allowed type", () => {
    const attachment = prepareAttachment(PDF_HEADER, "offer.pdf");
    expect(attachment.filename).toBe("offer.pdf");
    expect(Buffer.from(attachment.content, "base64")).toEqual(Buffer.from(PDF_HEADER));
  });

  it("refuses a file whose content is not one of the allowed types", () => {
    const zeros = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() => prepareAttachment(zeros, "mystery.bin")).toThrow(EmailError);
    try {
      prepareAttachment(zeros, "mystery.bin");
    } catch (error) {
      expect((error as EmailError).code).toBe("fileType");
    }
  });

  it("refuses a file over the size limit even when its content is fine", () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF_HEADER);
    try {
      prepareAttachment(big, "huge.pdf");
      expect.unreachable();
    } catch (error) {
      expect((error as EmailError).code).toBe("fileTooLarge");
    }
  });
});

describe("bodyToHtml", () => {
  it("escapes the body and keeps line breaks readable", () => {
    expect(bodyToHtml('Hi <b>"you"</b> & co')).toBe(
      '<p style="white-space:pre-wrap">Hi &#60;b&#62;&#34;you&#34;&#60;/b&#62; &#38; co</p>',
    );
  });
});
