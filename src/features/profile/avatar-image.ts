/** What is stored: the cropped square, at most this big (the buckets' own limit). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/**
 * What may be picked: a phone's photo is 3–8 MB; it is cropped and re-encoded
 * to AVATAR_OUTPUT_SIZE in the browser before anything is uploaded.
 */
export const AVATAR_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;

export type AvatarMime = "image/jpeg" | "image/png";
/** A picked file: JPG and PNG, and HEIC / HEIF, the iPhone's photos (saved as JPG). */
export type AvatarInputType = AvatarMime | "image/heic";

/** The file picker's types: HEIC too, so a Mac offers the photos from an iPhone. */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.heic,.heif";

/** The ISO base media brands of HEIC / HEIF still images (ftyp box at byte 4). */
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** Detects a picked photo from its first 12 bytes, not from its name or claimed type. */
export function sniffAvatarInput(bytes: Uint8Array): AvatarInputType | null {
  const mime = sniffImageType(bytes);
  if (mime) return mime;
  if (bytes.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12)) ? "image/heic" : null;
}

/** What the crop is saved as: PNG stays PNG (transparency of a logo), everything else JPG. */
export function avatarOutputMime(input: AvatarInputType): AvatarMime {
  return input === "image/png" ? "image/png" : "image/jpeg";
}

/** Detects JPG/PNG from the file's first bytes, not from its name or claimed type. */
export function sniffImageType(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) return "image/png";
  return null;
}

export type CropInput = {
  naturalWidth: number;
  naturalHeight: number;
  /** Side of the square crop frame on screen, px. */
  frame: number;
  /** Pan/zoom state of the image inside the frame. */
  scale: number;
  x: number;
  y: number;
};

/**
 * The image is drawn so its shorter side fills the frame at scale 1 and then
 * translated by (x, y) and scaled from the top-left corner. Returns the square
 * of the original image that is visible inside the frame.
 */
export function cropSquare({ naturalWidth, naturalHeight, frame, scale, x, y }: CropInput) {
  const fit = frame / Math.min(naturalWidth, naturalHeight);
  const size = Math.min(frame / (scale * fit), naturalWidth, naturalHeight);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    sx: clamp(-x / scale / fit, naturalWidth - size),
    sy: clamp(-y / scale / fit, naturalHeight - size),
    size,
  };
}

/** Keeps the frame covered: the scaled image may never reveal an empty edge. */
export function clampPan(
  {
    naturalWidth,
    naturalHeight,
    frame,
  }: Pick<CropInput, "naturalWidth" | "naturalHeight" | "frame">,
  scale: number,
  x: number,
  y: number,
) {
  const fit = frame / Math.min(naturalWidth, naturalHeight);
  const width = naturalWidth * fit * scale;
  const height = naturalHeight * fit * scale;
  return {
    x: Math.min(0, Math.max(frame - width, x)),
    y: Math.min(0, Math.max(frame - height, y)),
  };
}
