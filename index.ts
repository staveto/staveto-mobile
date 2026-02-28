console.log("[ENTRY] index.ts start");

/**
 * App Entry Point
 *
 * CRITICAL: Import order matters!
 * 1. react-native-gesture-handler must load before any screens/components
 * 2. preventAutoHideAsync fire-and-forget (never blocks)
 * 3. Failsafe: splash ALWAYS hides after 3s/10s (runs synchronously)
 * 4. registerRootComponent IMMEDIATELY with lazy App (never wait for async)
 */

// Suppress Firebase modular deprecation warnings (we use modular API; lib internals may still log)
(globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// Initialize gesture handler (required by React Navigation)
import "react-native-gesture-handler";
import { registerRootComponent } from "expo";

// Prevent auto-hide (fire-and-forget – must NOT block; iOS can hang here)
(async () => {
  try {
    const SplashScreen = require("expo-splash-screen");
    await SplashScreen.preventAutoHideAsync?.();
  } catch {}
})();

// Failsafe: always hide splash even if App never mounts (runs regardless of async above)
setTimeout(() => {
  try {
    require("expo-splash-screen").hideAsync?.().catch(() => {});
  } catch {}
}, 3000);
setTimeout(() => {
  try {
    require("expo-splash-screen").hideAsync?.().catch(() => {});
  } catch {}
}, 10000);

// Lazy import App – register IMMEDIATELY so first paint happens; heavy imports load after
registerRootComponent(() => {
  const React = require("react");
  const { useEffect, useState } = React;

  function Entry() {
    const [App, setApp] = useState<React.ComponentType | null>(null);

    useEffect(() => {
      import("./App")
        .then((m) => setApp(() => m.default))
        .catch(() => {});
    }, []);

    if (!App) return null;
    return React.createElement(App);
  }

  return React.createElement(Entry);
});
