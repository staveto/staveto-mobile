/**
 * App Entry Point
 *
 * CRITICAL: Import order matters!
 * 1. react-native-gesture-handler must load before any screens/components
 * 2. SplashScreen.preventAutoHideAsync before first paint (avoids black screen)
 * 3. Then register the root component
 */

// Suppress Firebase modular deprecation warnings (we use modular API; lib internals may still log)
(globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// Initialize gesture handler (required by React Navigation)
import "react-native-gesture-handler";

// Keep native splash visible until BootLoader explicitly hides it (avoids black screen on first launch)
try {
  const SplashScreen = require("expo-splash-screen");
  SplashScreen.preventAutoHideAsync?.();
} catch {
  // ignore
}

// Register root component
import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
