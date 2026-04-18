/**
 * One-off / maintenance: crops onboarding step PNGs to tight bounds around non-empty pixels.
 * Run: node scripts/trim-onboarding-pngs.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PAD = 12;

function isContent(r, g, b, a) {
  const lum = (r + g + b) / 3;
  return (
    a > 20 &&
    (a < 250 || lum < 248 || Math.max(r, g, b) - Math.min(r, g, b) > 15)
  );
}

async function contentBBox(pngPath) {
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isContent(r, g, b, a)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return { minX, minY, maxX, maxY, w, h };
}

async function trimFile(rel) {
  const pngPath = path.join(root, rel);
  const box = await contentBBox(pngPath);
  if (!box) {
    console.error("No content:", rel);
    return;
  }
  const cw = box.maxX - box.minX + 1;
  const ch = box.maxY - box.minY + 1;
  const left = Math.max(0, box.minX - PAD);
  const top = Math.max(0, box.minY - PAD);
  const right = Math.min(box.w, box.maxX + PAD + 1);
  const bottom = Math.min(box.h, box.maxY + PAD + 1);
  const width = right - left;
  const height = bottom - top;

  const before = await sharp(pngPath).metadata();
  const out = await sharp(pngPath).extract({ left, top, width, height }).png({ compressionLevel: 9 }).toBuffer();

  await fs.promises.writeFile(pngPath, out);
  const after = await sharp(pngPath).metadata();
  console.log(
    rel,
    `${before.width}x${before.height}`,
    "->",
    `${after.width}x${after.height}`,
    `(content ~${cw}x${ch}, pad ${PAD})`
  );
}

const files = ["assets/onboarding_1.png", "assets/onboarding_2.png", "assets/onboarding_3.png"];
for (const f of files) {
  await trimFile(f);
}
console.log("Done.");
