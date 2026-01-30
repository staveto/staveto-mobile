"use strict";
const fs = require("fs");
const path = require("path");

const mobileAssets = path.join(__dirname, "..", "assets");
const logoPath = path.join(mobileAssets, "logo.png");
const rootAssets = path.join(__dirname, "..", "..", "assets");
const projectLogoPng = path.join(rootAssets, "logo.png");
const projectLogoAlt = path.join(rootAssets, "Staveto Bielo Orandžové.png");
const iconPath = path.join(mobileAssets, "icon.png");

if (fs.existsSync(projectLogoPng)) {
  fs.copyFileSync(projectLogoPng, logoPath);
  console.log("[ensure-logo] logo.png skopírované z assets/logo.png");
} else if (fs.existsSync(projectLogoAlt)) {
  fs.copyFileSync(projectLogoAlt, logoPath);
  console.log("[ensure-logo] logo.png z 'Staveto Bielo Orandžové.png'.");
} else if (!fs.existsSync(logoPath) && fs.existsSync(iconPath)) {
  fs.copyFileSync(iconPath, logoPath);
  console.log("[ensure-logo] logo.png z icon.png.");
}
