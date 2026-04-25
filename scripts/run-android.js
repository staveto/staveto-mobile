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
const gradleJtmp = path.join(gradleHome, "jtmp");

try {
  fs.mkdirSync(gradleHome, { recursive: true });
  fs.mkdirSync(gradleJtmp, { recursive: true });
} catch (e) {}

/** Short paths for Gradle/Ninja; Cursor can inject TMP / GRADLE_USER_HOME under cursor-sandbox-cache (>260 chars). */
const baseEnv = { ...process.env };
if (process.platform === "win32") {
  const bad = (v) => typeof v === "string" && v.toLowerCase().includes("cursor-sandbox-cache");
  for (const k of Object.keys(baseEnv)) {
    if (bad(baseEnv[k])) {
      delete baseEnv[k];
    }
  }
}
const env = {
  ...baseEnv,
  GRADLE_USER_HOME: gradleHome,
  TMP: gradleHome,
  TEMP: gradleHome,
  TMPDIR: gradleHome,
  REACT_NATIVE_ARCHITECTURES: "x86_64",
};
if (process.platform === "win32") {
  const tmpOpt = `-Djava.io.tmpdir=${gradleJtmp.replace(/\\/g, "/")}`;
  env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, tmpOpt].filter(Boolean).join(" ").trim();
  /** Expo CLI picks another Metro port without prompting when CI is set (non-interactive terminals). */
  if (env.CI == null && process.env.CI == null) {
    env.CI = "true";
  }
}

let cwd = projectRoot;

if (process.platform === "win32" && process.env.STAVETO_ANDROID_USE_SUBST === "1") {
  // Optional: map project to Z:\ to reduce Windows MAX_PATH issues (can break autolinking on some setups).
  spawnSync("subst", ["Z:", "/d"], { stdio: "ignore" });
  const sub = spawnSync("subst", ["Z:", projectRoot], { stdio: "pipe" });
  if (sub.status === 0) {
    cwd = "Z:\\";
  }
}

const androidDir = cwd === "Z:\\" ? "Z:\\android" : path.join(projectRoot, "android");
const gradlew = process.platform === "win32" ? path.join(androidDir, "gradlew.bat") : path.join(androidDir, "gradlew");
spawnSync(gradlew, ["--stop"], { cwd: androidDir, env, stdio: "ignore", shell: process.platform === "win32" });

/** Avoid interactive "port in use" when another Metro is running (set EXPO_METRO_PORT e.g. 8083). */
const metroPort = process.env.EXPO_METRO_PORT || process.env.RCT_METRO_PORT || "8081";

/** Drop stale native CMake cache when switching away from Cursor sandbox (set STAVETO_EXPO_NO_BUILD_CACHE=0 to skip). */
const noBuildCache =
  process.env.STAVETO_EXPO_NO_BUILD_CACHE === "0" ? "" : process.platform === "win32" ? " --no-build-cache" : "";

/**
 * Windows: spawn `npx` via `shell: true` so .cmd resolution works; prepend SET so Gradle/Ninja avoid Cursor sandbox TEMP.
 */
let result;
if (process.platform === "win32") {
  /** `set "VAR=C:\g"` — not `set VAR="C:\g"` (quotes would become part of the value and break tools). */
  const esc = (s) => String(s).replace(/"/g, '""');
  const line = `set "GRADLE_USER_HOME=${esc(gradleHome)}"& set "TMP=${esc(gradleHome)}"& set "TEMP=${esc(gradleHome)}"& set "TMPDIR=${esc(gradleHome)}"& cd /d "${esc(cwd)}"& npx expo run:android --port ${String(metroPort)}${noBuildCache}`;
  result = spawnSync(line, { shell: true, stdio: "inherit", cwd, env });
} else {
  const extra = noBuildCache ? ["--no-build-cache"] : [];
  result = spawnSync("npx", ["expo", "run", "android", "--port", String(metroPort), ...extra], {
    stdio: "inherit",
    shell: false,
    cwd,
    env,
  });
}

if (process.platform === "win32" && cwd === "Z:\\") {
  spawnSync("subst", ["Z:", "/d"], { stdio: "ignore" });
}
process.exit(result.status ?? 1);
