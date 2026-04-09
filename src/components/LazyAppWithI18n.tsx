/**
 * Renders AppWithI18n after BootLoader finishes.
 *
 * Previously used dynamic import("../AppWithI18n") to split the bundle; on Android + Metro
 * that async chunk could hang indefinitely ("Načítavam aplikáciu…"). Static import keeps the
 * same module graph but loads synchronously when this file is evaluated (after splash/boot).
 */
import React from "react";
import AppWithI18n from "../AppWithI18n";

export function LazyAppWithI18n({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <AppWithI18n />;
}
