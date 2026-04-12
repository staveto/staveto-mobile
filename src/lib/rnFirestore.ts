import { getFirestore } from "../firebase";
import firestoreDefault, { firebase as rnfbFirebase } from "@react-native-firebase/firestore";

function firestoreInstance() {
  const fs = getFirestore();
  if (!fs) throw new Error("FIRESTORE_NOT_READY");
  return fs;
}

type CollectionRef = FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
type DocumentRef = FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
type QueryRef = FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;

type WhereConstraint = {
  type: "where";
  fieldPath: string;
  opStr: FirebaseFirestore.WhereFilterOp;
  value: unknown;
};

type OrderByConstraint = {
  type: "orderBy";
  fieldPath: string;
  directionStr?: FirebaseFirestore.OrderByDirection;
};

type LimitConstraint = {
  type: "limit";
  limit: number;
};

type QueryConstraint = WhereConstraint | OrderByConstraint | LimitConstraint;

export function collection(_db: unknown, path: string): CollectionRef {
  return firestoreInstance().collection(path);
}

export function collectionGroup(_db: unknown, path: string): QueryRef {
  return firestoreInstance().collectionGroup(path);
}

export function doc(target: unknown, ...pathSegments: string[]): DocumentRef {
  if (typeof target === "string") {
    const path = [target, ...pathSegments].join("/");
    return firestoreInstance().doc(path);
  }
  if (target && typeof (target as DocumentRef).doc === "function") {
    const path = pathSegments.join("/");
    return (target as CollectionRef).doc(path);
  }
  const path = pathSegments.join("/");
  return firestoreInstance().doc(path);
}

export function where(fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown): WhereConstraint {
  return { type: "where", fieldPath, opStr, value };
}

export function orderBy(fieldPath: string, directionStr?: FirebaseFirestore.OrderByDirection): OrderByConstraint {
  return { type: "orderBy", fieldPath, directionStr };
}

export function limit(limitValue: number): LimitConstraint {
  return { type: "limit", limit: limitValue };
}

export function query(base: CollectionRef | QueryRef, ...constraints: QueryConstraint[]): QueryRef {
  let q: QueryRef = base as QueryRef;
  for (const c of constraints) {
    if (c.type === "where") {
      q = q.where(c.fieldPath, c.opStr, c.value);
    } else if (c.type === "orderBy") {
      q = q.orderBy(c.fieldPath, c.directionStr);
    } else if (c.type === "limit") {
      q = q.limit(c.limit);
    }
  }
  return q;
}

export function getDoc(ref: DocumentRef, options?: FirebaseFirestore.GetOptions) {
  if (options != null) {
    return (ref as FirebaseFirestore.DocumentReference).get(options);
  }
  return require("@react-native-firebase/firestore").getDoc(ref);
}

export function getDocs(ref: QueryRef | CollectionRef, options?: FirebaseFirestore.GetOptions) {
  if (options != null) {
    return (ref as FirebaseFirestore.Query).get(options);
  }
  return require("@react-native-firebase/firestore").getDocs(ref);
}

export function addDoc(ref: CollectionRef, data: FirebaseFirestore.DocumentData) {
  return ref.add(data);
}

export function setDoc(ref: DocumentRef, data: FirebaseFirestore.DocumentData, options?: FirebaseFirestore.SetOptions) {
  return ref.set(data, options);
}

export function updateDoc(ref: DocumentRef, data: FirebaseFirestore.UpdateData) {
  return ref.update(data);
}

export function deleteDoc(ref: DocumentRef) {
  return ref.delete();
}

export function writeBatch(_db?: unknown) {
  return firestoreInstance().batch();
}

export function runTransaction<T>(
  updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>
): Promise<T> {
  return firestoreInstance().runTransaction(updateFunction);
}

export function serverTimestamp() {
  // RNFB v23: `FieldValue` is on the firestore *namespace* (default export / `firebase.firestore`), not on `default()` instance.
  const ns = firestoreDefault as unknown as { FieldValue?: { serverTimestamp: () => unknown } };
  if (ns.FieldValue?.serverTimestamp) {
    return ns.FieldValue.serverTimestamp();
  }
  const rootNs = rnfbFirebase?.firestore as unknown as { FieldValue?: { serverTimestamp: () => unknown } } | undefined;
  if (rootNs?.FieldValue?.serverTimestamp) {
    return rootNs.FieldValue.serverTimestamp();
  }
  const { firebase } = require("@react-native-firebase/app") as {
    firebase: { firestore: { FieldValue: { serverTimestamp: () => unknown } } };
  };
  return firebase.firestore.FieldValue.serverTimestamp();
}

/**
 * Use the package `Timestamp` namespace (same as `firestore().Timestamp` on the default export).
 * Avoids the re-exported `Timestamp` Proxy and avoids calling `getFirestore()` before the module graph is ready
 * (which can leave a named import binding undefined during circular init).
 */
export function firestoreTimestampFromDate(date: Date): FirebaseFirestore.Timestamp {
  const ns = firestoreDefault as unknown as { Timestamp?: { fromDate: (d: Date) => FirebaseFirestore.Timestamp } };
  if (ns.Timestamp?.fromDate) {
    return ns.Timestamp.fromDate(date);
  }
  const rootNs = rnfbFirebase?.firestore as unknown as
    | { Timestamp?: { fromDate: (d: Date) => FirebaseFirestore.Timestamp } }
    | undefined;
  if (rootNs?.Timestamp?.fromDate) {
    return rootNs.Timestamp.fromDate(date);
  }
  return firestoreInstance().Timestamp.fromDate(date);
}

let _TimestampClass: FirebaseFirestore.Timestamp | null = null;
function getTimestampClass(): FirebaseFirestore.Timestamp {
  if (!_TimestampClass) _TimestampClass = firestoreInstance().Timestamp;
  return _TimestampClass;
}
export const Timestamp = new Proxy(function Timestamp() {} as unknown as FirebaseFirestore.Timestamp, {
  get(_, prop) {
    return (getTimestampClass() as Record<string, unknown>)[prop as string];
  },
  construct(_target, args) {
    return new (getTimestampClass() as unknown as new (...a: unknown[]) => FirebaseFirestore.Timestamp)(...args);
  },
});

export type Unsubscribe = () => void;

export function onSnapshot(
  ref: DocumentRef | QueryRef | CollectionRef,
  onNext: (snap: any) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return (ref as any).onSnapshot(onNext, onError);
}

