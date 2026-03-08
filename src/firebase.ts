import type { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import firestoreModule from "@react-native-firebase/firestore";
import storageModule from "@react-native-firebase/storage";
import { getApp } from "@react-native-firebase/app";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { IOS_SKIP_AUTH } from "./lib/iosDiagnostic";
import { withTimeout, isTimeoutOrOfflineError } from "./utils/withTimeout";

const REGION = "europe-west1";

let _auth: ReturnType<typeof import("@react-native-firebase/auth")["default"]> | null = null;
let _firestore: FirebaseFirestoreTypes.Module | null = null;
let _storage: ReturnType<typeof storageModule> | null = null;
let _functions: ReturnType<typeof getFunctions> | null = null;

export function getAuth() {
  if (IOS_SKIP_AUTH) return null;
  if (_auth) return _auth;
  try {
    getApp();
    // Lazy-load auth module (prevents iOS native crash when loaded at app startup)
    const authModule = require("@react-native-firebase/auth").default;
    _auth = authModule();
    return _auth;
  } catch (e) {
    console.log("[firebase] getAuth failed:", String(e));
    return null;
  }
}

export function getFirestore() {
  if (IOS_SKIP_AUTH) return null;
  if (_firestore) return _firestore;
  try {
    _firestore = firestoreModule();
    return _firestore;
  } catch (e) {
    console.log("[firebase] getFirestore failed:", String(e));
    return null;
  }
}

export function getStorage() {
  if (IOS_SKIP_AUTH) return null;
  if (_storage) return _storage;
  try {
    _storage = storageModule();
    return _storage;
  } catch (e) {
    console.log("[firebase] getStorage failed:", String(e));
    return null;
  }
}

export function getFunctionsInstance() {
  if (IOS_SKIP_AUTH) return null;
  if (_functions) return _functions;
  try {
    const app = getApp();
    _functions = getFunctions(app, REGION);
    return _functions;
  } catch (e) {
    console.log("[firebase] getFunctionsInstance failed:", String(e));
    return null;
  }
}

const FUNCTIONS_TIMEOUT_MS = 6000;

/** Keep call style: getCallable("name")(data). Wrapped with 6s timeout for fast fail on weak network. */
export const getCallable = <T = unknown, R = unknown>(name: string) => {
  return async (data: T) => {
    if (IOS_SKIP_AUTH) throw new Error("FIREBASE_DISABLED");
    const fns = getFunctionsInstance();
    if (!fns) throw new Error("FIREBASE_FUNCTIONS_NOT_READY");
    try {
      return await withTimeout(
        httpsCallable<T, R>(fns, name)(data),
        FUNCTIONS_TIMEOUT_MS,
        name
      );
    } catch (err) {
      if (isTimeoutOrOfflineError(err)) {
        const friendly = new Error(
          "Slabé pripojenie alebo žiadny internet. Skúste znova neskôr."
        ) as Error & { code?: string };
        friendly.code = "NETWORK_ERROR";
        (friendly as Error & { cause?: unknown }).cause = err;
        throw friendly;
      }
      throw err;
    }
  };
};

/** Back-compat: auth() returns getAuth(); auth.currentUser works for legacy code */
const authFn = () => getAuth();
Object.defineProperty(authFn, "currentUser", {
  get: () => getAuth()?.currentUser ?? null,
  configurable: true,
  enumerable: true,
});
export const auth = authFn as typeof import("@react-native-firebase/auth")["default"];
/** Back-compat: storage() returns getStorage() - no top-level init */
export const storage = () => getStorage();
/** Back-compat: firestore() returns getFirestore() - no top-level init */
export const firestore = () => getFirestore();

/**
 * Back-compat Firestore instance for code that does: doc(db, "users", uid)
 */
export const db = new Proxy({} as FirebaseFirestoreTypes.Module, {
  get(_target, prop) {
    const fs = getFirestore();
    if (!fs) throw new Error("FIRESTORE_NOT_READY");
    return (fs as any)[prop];
  },
});
