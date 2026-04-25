#!/usr/bin/env node
/**
 * adb uninstall com.staveto.app, then same Android run as dev:android (subst + short Gradle paths).
 * Use EXPO_METRO_PORT if 8081 is taken (default here: 8083).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const pkg = "com.staveto.app";
const adb = path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe");

if (!fs.existsSync(adb)) {
  console.error("[reinstall-android] adb not found at:", adb);
  process.exit(1);
}

console.log("[reinstall-android] adb devices");
spawnSync(adb, ["devices"], { stdio: "inherit", shell: true });

console.log("[reinstall-android] adb uninstall", pkg, "(ok if not installed)");
let un = spawnSync(adb, ["uninstall", pkg], { stdio: "inherit", shell: true });
if ((un.status ?? 1) !== 0) {
  console.log("[reinstall-android] retry: pm uninstall --user 0");
  spawnSync(adb, ["shell", "pm", "uninstall", "--user", "0", pkg], { stdio: "inherit", shell: true });
}

const env = {
  ...process.env,
  EXPO_METRO_PORT: process.env.EXPO_METRO_PORT || "8083",
};

const run = spawnSync(process.execPath, [path.join(__dirname, "run-android.js")], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
