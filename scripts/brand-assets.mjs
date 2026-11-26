// Draws the Gradus logo as vectors and writes every file made from it:
//   src/components/brand/logo-geometry.ts  the shapes the <Logo> component draws
//   public/brand/*.svg, *.png              the logo for the web, press and social
//   src/app/icon.svg, favicon.ico, apple-icon.png  the browser and home-screen icons
//
// Run: bun run brand:assets  (node, because sharp hangs under bun)
//
// The shapes were measured from the two approved raster designs (icon 1024 px,
// lockup 1408 × 768): three bars 330 × 132 with 39.5 radius, each half a bar
// to the right and 30 above the one below; the middle bar runs violet → teal
// from bottom left to top right. The name is Poppins SemiBold (OFL), set at
// 260 units, 47 units right of the mark, baseline 94 units below its centre;
// on the lockup it overlaps the raster at 95 % IoU.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");
const fontkit = require("fontkit");

// ---------------------------------------------------------------- geometry

const COLORS = { violet: "#705afc", teal: "#29cbc3", night: "#0b0f1a", white: "#ffffff" };

const BAR = { width: 330, height: 132, radius: 39.5 };
const MARK = { width: 660, height: 456 };
const BARS = [
  { x: 0, y: 324, fill: "violet" },
  { x: 165, y: 162, fill: "gradient" },
  { x: 330, y: 0, fill: "teal" },
];
/** In mark units; measured: the colour is linear along this line, clamped beyond. */
const GRADIENT = { x1: 218, y1: 297, x2: 460, y2: 147 };

const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf";
const FONT_SIZE = 260;
const NAME = "Gradus";
const NAME_GAP = 47;
const BASELINE = MARK.height / 2 + 94;

// ---------------------------------------------------------------- wordmark

async function loadFont() {
  const cache = path.join(root, "node_modules/.cache/brand/Poppins-SemiBold.ttf");
  if (!existsSync(cache)) {
    mkdirSync(path.dirname(cache), { recursive: true });
    const response = await fetch(FONT_URL);
    if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
    writeFileSync(cache, Buffer.from(await response.arrayBuffer()));
  }
  return fontkit.openSync(cache);
}

const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

function wordmark(font) {
  const scale = FONT_SIZE / font.unitsPerEm;
  const run = font.layout(NAME);
  let pen = 0;
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  const glyphs = run.glyphs.map((glyph, i) => {
    const pos = run.positions[i];
    const at = pen + pos.xOffset;
    inkLeft = Math.min(inkLeft, at + glyph.bbox.minX);
    inkRight = Math.max(inkRight, at + glyph.bbox.maxX);
    pen += pos.xAdvance;
    return { glyph, at, dy: pos.yOffset };
  });
  const left = MARK.width + NAME_GAP;
  const d = glyphs
    .map(({ glyph, at, dy }) =>
      glyph.path.commands
        .map(({ command, args }) => {
          const pts = [];
          for (let k = 0; k < args.length; k += 2) {
            pts.push(round(left + (at + args[k] - inkLeft) * scale));
            pts.push(round(BASELINE - (args[k + 1] + dy) * scale));
          }
          const letter = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C", closePath: "Z" }[command];
          return letter + pts.join(" ");
        })
        .join(""),
    )
    .join("");
  const width = (inkRight - inkLeft) * scale;
  return { d, x: left, width: Math.round(width * 100) / 100 };
}

// ---------------------------------------------------------------- svg

function markShapes({ id, offsetX = 0, offsetY = 0, scale = 1 }) {
  const t = (x, y) => [round(offsetX + x * scale), round(offsetY + y * scale)];
  const [gx1, gy1] = t(GRADIENT.x1, GRADIENT.y1);
  const [gx2, gy2] = t(GRADIENT.x2, GRADIENT.y2);
  const defs = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${gx1}" y1="${gy1}" x2="${gx2}" y2="${gy2}"><stop offset="0" stop-color="${COLORS.violet}"/><stop offset="1" stop-color="${COLORS.teal}"/></linearGradient></defs>`;
  const rects = BARS.map((bar) => {
    const [x, y] = t(bar.x, bar.y);
    const fill = bar.fill === "gradient" ? `url(#${id})` : COLORS[bar.fill];
    return `<rect x="${x}" y="${y}" width="${round(BAR.width * scale)}" height="${round(BAR.height * scale)}" rx="${round(BAR.radius * scale)}" fill="${fill}"/>`;
  }).join("");
  return defs + rects;
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

/** The mark centred on a night square, as in the approved icon (mark 64.5 % wide). */
function iconSvg({ size = 1024, markShare = MARK.width / 1024, radius = 0 }) {
  const scale = (size * markShare) / MARK.width;
  const offsetX = (size - MARK.width * scale) / 2;
  const offsetY = (size - MARK.height * scale) / 2;
  const bg = `<rect width="${size}" height="${size}" rx="${radius}" fill="${COLORS.night}"/>`;
  return svg(size, size, bg + markShapes({ id: "g", offsetX, offsetY, scale }), NAME);
}

// ---------------------------------------------------------------- ico

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// ---------------------------------------------------------------- write

const write = (rel, data) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log("wrote", rel);
};
const png = (svgText, width, height) =>
  sharp(Buffer.from(svgText), { density: 300 }).resize(width, height).png({ compressionLevel: 9 }).toBuffer();

const font = await loadFont();
const name = wordmark(font);
const lockupWidth = name.x + name.width;

const generated = `// Generated by scripts/brand-assets.mjs (bun run brand:assets). Do not edit by hand.

/** Logo colours; the same in every theme (tokens --color-logo-* in globals.css). */
export const LOGO_COLORS = ${JSON.stringify({ violet: COLORS.violet, teal: COLORS.teal, night: COLORS.night })} as const;

export const MARK = ${JSON.stringify({ ...MARK, bar: BAR, bars: BARS, gradient: GRADIENT })} as const;

/** The name in Poppins SemiBold as one path, in lockup units (mark at 0,0). */
export const WORDMARK = ${JSON.stringify({ x: name.x, width: name.width, d: name.d })} as const;

export const LOCKUP = ${JSON.stringify({ width: Math.round(lockupWidth * 100) / 100, height: MARK.height })} as const;
`;
write("src/components/brand/logo-geometry.ts", generated);
execFileSync(path.join(root, "node_modules/.bin/prettier"), ["--write", "src/components/brand/logo-geometry.ts"], { cwd: root });

const markSvg = svg(MARK.width, MARK.height, markShapes({ id: "g" }), NAME);
const lockup = (textColor) =>
  svg(lockupWidth, MARK.height, markShapes({ id: "g" }) + `<path fill="${textColor}" d="${name.d}"/>`, NAME);

write("public/brand/gradus-mark.svg", markSvg);
write("public/brand/gradus-logo.svg", lockup(COLORS.white));
write("public/brand/gradus-logo-on-light.svg", lockup(COLORS.night));
write("public/brand/gradus-icon.svg", iconSvg({}));

write("public/brand/gradus-mark.png", await png(markSvg, 1320, 912));
write("public/brand/gradus-logo.png", await png(lockup(COLORS.white), 2400, Math.round((2400 * MARK.height) / lockupWidth)));
write("public/brand/gradus-logo-on-light.png", await png(lockup(COLORS.night), 2400, Math.round((2400 * MARK.height) / lockupWidth)));
write("public/brand/gradus-icon-1024.png", await png(iconSvg({}), 1024, 1024));
write("public/brand/gradus-icon-512.png", await png(iconSvg({}), 512, 512));

// Browser tab: a rounded night tile with a larger mark, so the bars read at 16 px.
const tab = iconSvg({ markShare: 0.8, radius: 225 });
write("src/app/icon.svg", tab);
write(
  "src/app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(tab, size, size) })))),
);
// iOS rounds the corners itself: a full square like the approved icon.
write("src/app/apple-icon.png", await png(iconSvg({}), 180, 180));

console.log("lockup width", lockupWidth.toFixed(2));
