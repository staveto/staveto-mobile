#!/usr/bin/env node
/**
 * Run Android build with short Gradle cache path to avoid Windows 260-char limit.
 * Sets GRADLE_USER_HOME to C:\g (short path) before running expo run:android.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Short path for Gradle cache - avoids "Filename longer than 260 characters" on Windows
const gradleHome = process.platform === "win32" ? "C:\\g" : path.join(process.env.HOME || "/tmp", ".gradle-short");
process.env.GRADLE_USER_HOME = gradleHome;

// Ensure directory exists
try {
  fs.mkdirSync(gradleHome, { recursive: true });
} catch (e) {
  // ignore
}

const env = { ...process.env, GRADLE_USER_HOME: gradleHome, TMP: gradleHome, TEMP: gradleHome };
const androidDir = path.resolve(__dirname, "..", "android");
// Stop existing Gradle daemon so it picks up new GRADLE_USER_HOME
const gradlew = process.platform === "win32" ? path.join(androidDir, "gradlew.bat") : path.join(androidDir, "gradlew");
spawnSync(gradlew, ["--stop"], { cwd: androidDir, env, stdio: "ignore", shell: process.platform === "win32" });
const result = spawnSync("npx", ["expo", "run", "android"], {
  stdio: "inherit",
  shell: true,
  cwd: path.resolve(__dirname, ".."),
  env,
});
process.exit(result.status ?? 1);
