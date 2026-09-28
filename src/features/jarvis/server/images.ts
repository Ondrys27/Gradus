import "server-only";
import sharp from "sharp";

/** Longer edges are scaled down; the model sees no more detail above this. */
const MAX_EDGE = 1568;
/** The API takes images of up to 5 MB; stay safely below. */
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

export type ModelImage = { mediaType: "image/png" | "image/jpeg"; data: string };

/**
 * Prepares a PNG or JPEG for the model: turned upright, scaled to the size the
 * model reads, and re-encoded as JPEG when a PNG stays too large.
 */
export async function prepareImage(bytes: Uint8Array, kind: "png" | "jpeg"): Promise<ModelImage> {
  const base = sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });

  if (kind === "png") {
    const png = await base.clone().png({ compressionLevel: 9 }).toBuffer();
    if (png.length <= MAX_IMAGE_BYTES) {
      return { mediaType: "image/png", data: png.toString("base64") };
    }
  }
  const jpeg = await base
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { mediaType: "image/jpeg", data: jpeg.toString("base64") };
}
