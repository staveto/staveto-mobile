/**
 * Generates assets/splash-icon.png: white canvas, orange STAVETO + logo (matches Register look).
 * Run: node scripts/build-splash-white.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const W = 1024;
const H = 1024;
const PRIMARY = "#e06737";

async function main() {
  const logoPath = path.join(root, "assets", "logo.png");
  if (!fs.existsSync(logoPath)) {
    console.error("Missing assets/logo.png");
    process.exit(1);
  }

  const logoBuf = await sharp(logoPath).resize({ width: 320 }).toBuffer();
  const { width: lw = 0, height: lh = 0 } = await sharp(logoBuf).metadata();
  const lx = Math.floor((W - lw) / 2);
  const ly = 260;
  const textY = ly + lh + 36;

  const textSvg = Buffer.from(
    `<svg width="${W}" height="${H - textY}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="72" dominant-baseline="middle" text-anchor="middle"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
        font-size="96" font-weight="900" fill="${PRIMARY}" letter-spacing="10">STAVETO</text>
    </svg>`
  );

  const textPng = await sharp(textSvg).png().toBuffer();

  await sharp({
    create: { width: W, height: H, channels: 4, background: "#ffffff" },
  })
    .composite([
      { input: logoBuf, left: lx, top: ly },
      { input: textPng, left: 0, top: textY },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, "assets", "splash-icon.png"));

  console.log("Wrote assets/splash-icon.png", W, H);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
