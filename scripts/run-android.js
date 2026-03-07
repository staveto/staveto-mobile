#!/usr/bin/env node
/**
 * Run Android build with short paths to avoid Windows 260-char limit.
 * Uses subst Z: for project path, GRADLE_USER_HOME=C:\g for cache.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const gradleHome = process.platform === "win32" ? "C:\\g" : path.join(process.env.HOME || "/tmp", ".gradle-short");

try {
  fs.mkdirSync(gradleHome, { recursive: true });
} catch (e) {}

const env = {
  ...process.env,
  GRADLE_USER_HOME: gradleHome,
  TMP: gradleHome,
  TEMP: gradleHome,
  REACT_NATIVE_ARCHITECTURES: "x86_64",
};

let cwd = projectRoot;

if (process.platform === "win32") {
  // Use subst Z: for short project path
  spawnSync("subst", ["Z:", "/d"], { stdio: "ignore" });
  const sub = spawnSync("subst", ["Z:", projectRoot], { stdio: "pipe" });
  if (sub.status === 0) {
    cwd = "Z:\\";
  }
}

const androidDir = cwd === "Z:\\" ? "Z:\\android" : path.join(projectRoot, "android");
const gradlew = process.platform === "win32" ? path.join(androidDir, "gradlew.bat") : path.join(androidDir, "gradlew");
spawnSync(gradlew, ["--stop"], { cwd: androidDir, env, stdio: "ignore", shell: process.platform === "win32" });

const result = spawnSync("npx", ["expo", "run", "android"], {
  stdio: "inherit",
  shell: true,
  cwd,
  env,
});

if (process.platform === "win32") {
  spawnSync("subst", ["Z:", "/d"], { stdio: "ignore" });
}
process.exit(result.status ?? 1);
