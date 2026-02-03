/**
 * App Entry Point
 * 
 * CRITICAL: Import order matters!
 * 1. react-native-gesture-handler must load before any screens/components
 * 2. Then register the root component
 */

// Initialize gesture handler (required by React Navigation)
import "react-native-gesture-handler";

// Register root component
import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
