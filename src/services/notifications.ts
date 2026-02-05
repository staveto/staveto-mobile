import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  doc,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { DEV_EXPO_GO_UID } from "../constants/devUid";

export type NotificationEntityType = "task" | "project" | "expense" | "document";
export type NotificationEventType =
  | "assigned"
  | "status_changed"
  | "comment_added"
  | "expense_added"
  | "document_added";

export type NotificationDoc = {
  id: string;
  userId: string;
  projectId?: string;
  entityType: NotificationEntityType;
  entityId: string;
  eventType: NotificationEventType;
  title?: string;
  message: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
  readAt?: string | null;
  deepLink?: { screen: string; params?: Record<string, unknown> };
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): NotificationDoc {
  const d = docSnap.data();
  
  const convertTimestamp = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) {
      return ts.toDate().toISOString();
    }
    if (typeof ts === 'string') {
      return ts;
    }
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  
  return {
    id: docSnap.id,
    userId: (d.userId as string) ?? "",
    projectId: (d.projectId as string) ?? undefined,
    entityType: (d.entityType as NotificationEntityType) ?? "project",
    entityId: (d.entityId as string) ?? "",
    eventType: (d.eventType as NotificationEventType) ?? "comment_added",
    title: (d.title as string) ?? undefined,
    message: (d.message as string) ?? "",
    actorId: (d.actorId as string) ?? undefined,
    actorName: (d.actorName as string) ?? undefined,
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    readAt: convertTimestamp(d.readAt) ?? null,
    deepLink: (d.deepLink as { screen: string; params?: Record<string, unknown> }) ?? undefined,
  };
}

/**
 * List all notifications for a user, ordered by creation date (newest first)
 */
export async function listNotifications(
  userId: string,
  opts?: { limitCount?: number; unreadOnly?: boolean }
): Promise<NotificationDoc[]> {
  const uid = DEV_EXPO_GO_UID;
  
  try {
    const c = collection(db, "notifications");
    const clauses = [
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(opts?.limitCount ?? 30),
    ];
    if (opts?.unreadOnly) {
      clauses.splice(1, 0, where("readAt", "==", null));
    }
    const q = query(c, ...clauses);
    const snap = await getDocs(q);

    return snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
  } catch (error: any) {
    console.error(`[notifications] Error listing notifications:`, error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Unknown error';
    
    // If collection doesn't exist or is empty, return empty array
    if (errorCode === 'failed-precondition' || errorCode === 'not-found') {
      console.warn(`[notifications] Collection may not exist yet, returning empty array`);
      return [];
    }
    
    // If index is missing, try without orderBy
    if (errorCode === 'failed-precondition' && errorMessage.includes('index')) {
      console.warn(`[notifications] Index missing, trying without orderBy`);
      try {
        const c = collection(db, "notifications");
        const q = query(c, where("userId", "==", userId));
        const snap = await getDocs(q);
        const notifications = snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
        // Sort manually
        return notifications.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA; // Descending order
        });
      } catch (fallbackError: any) {
        console.error(`[notifications] Fallback query also failed:`, fallbackError);
        return [];
      }
    }
    
    // For other errors, return empty array instead of throwing
    console.warn(`[notifications] Returning empty array due to error:`, errorMessage);
    return [];
  }
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
  const uid = DEV_EXPO_GO_UID;
  
  const ref = doc(db, "notifications", notificationId);
  await updateDoc(ref, {
    readAt: serverTimestamp(),
  });
  
  console.log(`[notifications] Marked notification ${notificationId} as read for user ${userId}`);
}

/**
 * Create a notification for a user
 */
export async function createNotification(
  data: {
    userId: string;
    projectId?: string;
    entityType: NotificationEntityType;
    entityId: string;
    eventType: NotificationEventType;
    title?: string;
    message: string;
    actorId?: string;
    actorName?: string;
    deepLink?: { screen: string; params?: Record<string, unknown> };
  }
): Promise<NotificationDoc> {
  const uid = DEV_EXPO_GO_UID;

  const c = collection(db, "notifications");
  const ref = doc(c);
  await setDoc(ref, {
    userId: data.userId,
    projectId: data.projectId ?? null,
    entityType: data.entityType,
    entityId: data.entityId,
    eventType: data.eventType,
    title: data.title?.trim() ?? null,
    message: data.message.trim(),
    actorId: data.actorId ?? null,
    actorName: data.actorName ?? null,
    createdAt: serverTimestamp(),
    readAt: null,
    deepLink: data.deepLink ?? null,
  });

  return {
    id: ref.id,
    userId: data.userId,
    projectId: data.projectId,
    entityType: data.entityType,
    entityId: data.entityId,
    eventType: data.eventType,
    title: data.title,
    message: data.message,
    actorId: data.actorId,
    actorName: data.actorName,
    createdAt: new Date().toISOString(),
    readAt: null,
    deepLink: data.deepLink,
  };
}

export async function markAllAsRead(userId: string, maxCount: number = 100): Promise<void> {
  const uid = DEV_EXPO_GO_UID;

  const c = collection(db, "notifications");
  const q = query(
    c,
    where("userId", "==", userId),
    where("readAt", "==", null),
    orderBy("createdAt", "desc"),
    limit(maxCount)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    batch.update(d.ref, { readAt: serverTimestamp() });
  });
  await batch.commit();
}

/**
 * One-off self-check: write + read a test notification for current user.
 * Logs clear success/failure and surfaces Firestore errors.
 */
export async function runNotificationsSelfCheck(): Promise<void> {
  const uid = DEV_EXPO_GO_UID;

  try {
    console.log("[notifications:self-check] Writing test notification...");
    const created = await createNotification({
      userId: uid,
      entityType: "project",
      entityId: "self-check",
      eventType: "comment_added",
      title: "Test notifikácia",
      message: "Self-check test: read/write permissions.",
      actorId: uid,
      actorName: "Expo Go User",
    });

    console.log("[notifications:self-check] Created:", created.id);
    console.log("[notifications:self-check] Reading notifications...");
    const list = await listNotifications(uid, { limitCount: 5 });
    const found = list.some((n) => n.id === created.id);
    console.log(`[notifications:self-check] Read OK: ${found ? "FOUND" : "NOT FOUND"}`);
  } catch (error: any) {
    console.error("[notifications:self-check] Failed:", error?.message ?? error);
  }
}
