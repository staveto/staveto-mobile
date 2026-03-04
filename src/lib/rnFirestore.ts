import firestore from "@react-native-firebase/firestore";
import { getDoc as getDocModular, getDocs as getDocsModular } from "@react-native-firebase/firestore";

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
  return firestore().collection(path);
}

export function collectionGroup(_db: unknown, path: string): QueryRef {
  return firestore().collectionGroup(path);
}

export function doc(target: unknown, ...pathSegments: string[]): DocumentRef {
  if (typeof target === "string") {
    const path = [target, ...pathSegments].join("/");
    return firestore().doc(path);
  }
  if (target && typeof (target as DocumentRef).doc === "function") {
    const path = pathSegments.join("/");
    return (target as CollectionRef).doc(path);
  }
  const path = pathSegments.join("/");
  return firestore().doc(path);
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
  return getDocModular(ref);
}

export function getDocs(ref: QueryRef | CollectionRef, options?: FirebaseFirestore.GetOptions) {
  if (options != null) {
    return (ref as FirebaseFirestore.Query).get(options);
  }
  return getDocsModular(ref);
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
  return firestore().batch();
}

export function runTransaction<T>(
  updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>
): Promise<T> {
  return firestore().runTransaction(updateFunction);
}

export function serverTimestamp() {
  return firestore.FieldValue.serverTimestamp();
}

export const Timestamp = firestore.Timestamp;

export type Unsubscribe = () => void;

export function onSnapshot(
  ref: DocumentRef | QueryRef | CollectionRef,
  onNext: (snap: any) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return (ref as any).onSnapshot(onNext, onError);
}

