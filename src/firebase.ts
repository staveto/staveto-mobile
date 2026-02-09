import authModule from "@react-native-firebase/auth";
import firestoreModule from "@react-native-firebase/firestore";
import storageModule from "@react-native-firebase/storage";
import functionsModule from "@react-native-firebase/functions";

export const auth = authModule();
export const firestore = firestoreModule();
export const storage = storageModule();
const functionsInstance = functionsModule();
export const functions = () => functionsInstance;
export const db = firestore;
