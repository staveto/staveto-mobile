import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "../lib/rnFirestore";
import { auth, db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { ProjectEvent, ProjectEventType } from "../lib/types";
import { isPlainObject } from "../utils/isPlainObject";

type ProjectEventPayload = {
  actorName?: string;
  projectName?: string;
  taskTitle?: string;
  fileName?: string;
  amount?: number;
  currency?: string;
  supplier?: string;
  count?: number;
  email?: string;
  targetUserId?: string;
  targetEmail?: string;
  targetName?: string;
  text?: string;
};

type ProjectEventRef = {
  kind?: string;
  id?: string;
  [key: string]: unknown;
};

/** Firestore rejects `undefined` anywhere in document data (RN Firebase throws). */
export function omitUndefinedFields(obj: unknown): Record<string, unknown> {
  const plain = isPlainObject(obj) ? obj : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plain)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function toProjectEvent(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectEvent {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    type: data.type as ProjectEventType,
    createdAt: data.createdAt ?? new Date().toISOString(),
    actorId: (data.actorId as string) ?? "",
    actorName: (data.actorName as string | null | undefined) ?? null,
    payload: (data.payload as ProjectEventPayload | undefined) ?? {},
    ref: (data.ref as ProjectEventRef | null | undefined) ?? null,
  };
}

export async function addProjectEvent(
  projectId: string,
  type: ProjectEventType,
  payload?: ProjectEventPayload,
  ref?: ProjectEventRef
): Promise<void> {
  try {
    console.log("[addProjectEvent] payload", JSON.stringify(payload, null, 2));
    console.log("[addProjectEvent] ref", ref, typeof ref, Array.isArray(ref));
  } catch (e) {
    console.warn("[addProjectEvent] debug log failed:", e);
  }

  const currentUser = auth.currentUser;
  const actorId = currentUser?.uid ?? "system";
  const actorName = payload?.actorName ?? currentUser?.displayName ?? currentUser?.email ?? null;

  const eventsRef = collection(db, paths.projectEvents(projectId));
  const safePayload = omitUndefinedFields(payload) as ProjectEventPayload;
  const safeRef =
    ref != null && typeof ref === "object" && !Array.isArray(ref)
      ? (omitUndefinedFields(ref) as ProjectEventRef)
      : null;
  await addDoc(eventsRef, {
    type,
    createdAt: serverTimestamp(),
    actorId,
    actorName,
    payload: safePayload,
    ref: safeRef,
  });
}

export async function listProjectEvents(projectId: string, limitN: number = 30): Promise<ProjectEvent[]> {
  const eventsRef = collection(db, paths.projectEvents(projectId));
  const q = query(eventsRef, orderBy("createdAt", "desc"), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toProjectEvent({ id: d.id, data: d.data.bind(d) }));
}

export async function markProjectSeen(projectId: string, uid: string): Promise<void> {
  const stateRef = doc(db, paths.userProjectState(uid, projectId));
  await setDoc(
    stateRef,
    {
      uid,
      projectId,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getProjectLastSeenAt(projectId: string, uid: string): Promise<unknown | null> {
  const stateRef = doc(db, paths.userProjectState(uid, projectId));
  const snap = await getDoc(stateRef);
  if (!snap.exists()) return null;
  const data = snap.data() as { lastSeenAt?: unknown };
  return data.lastSeenAt ?? null;
}

export async function countNewEventsSince(projectId: string, lastSeenAt: unknown): Promise<number> {
  const eventsRef = collection(db, paths.projectEvents(projectId));
  const q = query(
    eventsRef,
    where("createdAt", ">", lastSeenAt),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  const snap = await getDocs(q);
  return snap.size;
}
