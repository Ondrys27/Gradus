import { describe, expect, it } from "vitest";
import { clampPan, cropSquare, sniffImageType } from "./avatar-image";
import { normalizeUsernameInput, usernameProblem } from "./username";

describe("username rules", () => {
  it("lowercases and removes spaces while typing", () => {
    expect(normalizeUsernameInput("Ondra Otava")).toBe("ondraotava");
  });

  it("explains what is wrong", () => {
    expect(usernameProblem("ondra.otava_1")).toBeNull();
    expect(usernameProblem("ab")).toBe("tooShort");
    expect(usernameProblem("a".repeat(21))).toBe("tooLong");
    expect(usernameProblem("ondra-otava")).toBe("invalidChars");
    expect(usernameProblem("ondřej")).toBe("invalidChars");
  });
});

describe("sniffImageType", () => {
  it("recognises JPG and PNG by their first bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
  });

  it("rejects everything else, whatever the file is called", () => {
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("cropSquare", () => {
  const landscape = { naturalWidth: 2000, naturalHeight: 1000, frame: 250 };

  it("takes the left square at rest and the centre when panned", () => {
    expect(cropSquare({ ...landscape, scale: 1, x: 0, y: 0 })).toEqual({
      sx: 0,
      sy: 0,
      size: 1000,
    });
    // Displayed 500×250, panned 125 px left → the middle 1000 px of the original.
    expect(cropSquare({ ...landscape, scale: 1, x: -125, y: 0 })).toEqual({
      sx: 500,
      sy: 0,
      size: 1000,
    });
  });

  it("shrinks the square when zoomed in", () => {
    const crop = cropSquare({ ...landscape, scale: 2, x: -250, y: -125 });
    expect(crop).toEqual({ sx: 500, sy: 250, size: 500 });
  });

  it("never reads outside the image", () => {
    const crop = cropSquare({ ...landscape, scale: 1, x: -9999, y: 50 });
    expect(crop.sx).toBe(1000);
    expect(crop.sy).toBe(0);
  });
});

describe("clampPan", () => {
  it("keeps the frame covered", () => {
    const image = { naturalWidth: 2000, naturalHeight: 1000, frame: 250 };
    expect(clampPan(image, 1, 40, 40)).toEqual({ x: 0, y: 0 });
    expect(clampPan(image, 1, -9999, -10)).toEqual({ x: -250, y: 0 });
    expect(clampPan(image, 2, -300, -200)).toEqual({ x: -300, y: -200 });
    expect(clampPan(image, 2, -300, -400)).toEqual({ x: -300, y: -250 });
  });
});
