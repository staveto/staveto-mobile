import authModule from "@react-native-firebase/auth";
import firestoreModule from "@react-native-firebase/firestore";
import storageModule from "@react-native-firebase/storage";
import functionsModule from "@react-native-firebase/functions";
import { getApp } from "@react-native-firebase/app";

const REGION = "europe-west1";

export const auth = authModule();
export const firestore = firestoreModule();
export const storage = storageModule();
const functionsInstance = functionsModule();
export const functions = () => functionsInstance;

/** Regional functions instance for europe-west1. Use getApp() for consistent app context (auth token). */
export const getFns = () => getApp().functions(REGION);

if (__DEV__) {
  const projectId = auth.app?.options?.projectId ?? "?";
  console.log("[functions] region", REGION, "projectId", projectId);
}

export const db = firestore;
