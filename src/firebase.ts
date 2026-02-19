import authModule from "@react-native-firebase/auth";
import firestoreModule from "@react-native-firebase/firestore";
import storageModule from "@react-native-firebase/storage";
import { getApp } from "@react-native-firebase/app";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";

const REGION = "europe-west1";

export const auth = authModule();
export const firestore = firestoreModule();
export const storage = storageModule();

/** @deprecated Use getCallable() for modular API. */
export const getFns = () => getApp().functions(REGION);

/** Modular: get Functions instance for europe-west1. */
export const getFunctionsInstance = () => getFunctions(getApp(), REGION);

/** Modular: get a callable function. Use: getCallable("name")(data) */
export const getCallable = <T = unknown, R = unknown>(name: string) =>
  httpsCallable<T, R>(getFunctionsInstance(), name);

if (__DEV__) {
  const projectId = auth.app?.options?.projectId ?? "?";
  console.log("[functions] region", REGION, "projectId", projectId);
}

export const db = firestore;
