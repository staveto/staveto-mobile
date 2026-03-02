/**
 * Boot-step logger for crash investigation (no Mac needed).
 * Persists to AsyncStorage – survives crashes, readable on TestFlight.
 * Re-exports from bootLogger for task spec; bootLogger has full implementation.
 */
export {
  bootStep,
  bootFail,
  getLastBootStep,
  getBootLogEntries,
  getLastError,
  type BootStep,
} from "./bootLogger";
