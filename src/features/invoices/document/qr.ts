import { encode } from "uqr";

export type QrPath = { size: number; d: string };

/**
 * The QR code as one SVG path of its dark modules, the same for the PDF and
 * the preview. Error correction M, as the ČBA recommends for QR Platba; the
 * quiet zone is the template's margin, not part of the path.
 */
export function qrPath(text: string): QrPath {
  const { size, data } = encode(text, { ecc: "M", border: 0 });
  let d = "";
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!data[y][x]) {
        x += 1;
        continue;
      }
      // One rectangle per run of dark modules keeps the path short.
      let run = 1;
      while (x + run < size && data[y][x + run]) run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size, d };
}
