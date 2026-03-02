"use strict";
/**
 * Fix adaptive icon for Android – content must fit in safe zone (~66% center).
 * Android applies circular mask; content near edges gets cut off.
 * This script scales the logo to 66% and centers it.
 */
const fs = require("fs");
const path = require("path");

const assetsDir = path.join(__dirname, "..", "assets");
const inputPath = path.join(assetsDir, "adaptive-icon.png");
const outputPath = path.join(assetsDir, "adaptive-icon.png");
const safeZonePercent = 0.66; // Android safe zone

async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.error(
      "[fix-adaptive-icon] sharp nie je nainštalovaný. Spusti: npm install sharp --save-dev"
    );
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error("[fix-adaptive-icon] adaptive-icon.png nenájdený v assets/");
    process.exit(1);
  }

  const size = 1024;
  const contentSize = Math.round(size * safeZonePercent);

  const img = sharp(inputPath);
  const meta = await img.metadata();
  const w = meta.width || size;
  const h = meta.height || size;

  const scaled = await sharp(inputPath)
    .resize(contentSize, contentSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const left = Math.round((size - contentSize) / 2);
  const top = Math.round((size - contentSize) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .png()
    .toFile(outputPath);

  console.log(
    `[fix-adaptive-icon] adaptive-icon.png upravený – obsah zmenšený na ${Math.round(safeZonePercent * 100)}% (bezpečná zóna)`
  );
}

main().catch((err) => {
  console.error("[fix-adaptive-icon] Chyba:", err.message);
  process.exit(1);
});
