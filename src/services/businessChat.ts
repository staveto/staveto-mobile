import { getAuth, db, getStorage } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "../lib/rnFirestore";

export type BusinessChatType = "general";
export type BusinessChatMessageType = "text" | "image";

export type BusinessChatDoc = {
  id: string;
  orgId: string;
  type: BusinessChatType;
  title: string;
  createdAt: unknown;
  updatedAt: unknown;
  lastMessageText: string;
  lastMessageAt: unknown;
  lastMessageByUid: string | null;
};

export type BusinessChatMessageDoc = {
  id: string;
  orgId: string;
  chatId: string;
  senderUid: string;
  senderName: string;
  senderEmail: string;
  text: string;
  type: BusinessChatMessageType;
  imageUrl?: string;
  storagePath?: string;
  createdAt: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
  status: "sent";
};

function requireUid(): string {
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!uid) {
    throw new Error("Musíte byť prihlásený.");
  }
  return uid;
}

function toChatDoc(id: string, raw: Record<string, unknown>): BusinessChatDoc {
  return {
    id,
    orgId: typeof raw.orgId === "string" ? raw.orgId : "",
    type: raw.type === "general" ? "general" : "general",
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "General",
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    lastMessageText: typeof raw.lastMessageText === "string" ? raw.lastMessageText : "",
    lastMessageAt: raw.lastMessageAt ?? null,
    lastMessageByUid: typeof raw.lastMessageByUid === "string" ? raw.lastMessageByUid : null,
  };
}

function toMessageDoc(id: string, raw: Record<string, unknown>): BusinessChatMessageDoc {
  const messageType: BusinessChatMessageType = raw.type === "image" ? "image" : "text";
  return {
    id,
    orgId: typeof raw.orgId === "string" ? raw.orgId : "",
    chatId: typeof raw.chatId === "string" ? raw.chatId : "",
    senderUid: typeof raw.senderUid === "string" ? raw.senderUid : "",
    senderName: typeof raw.senderName === "string" ? raw.senderName : "",
    senderEmail: typeof raw.senderEmail === "string" ? raw.senderEmail : "",
    text: typeof raw.text === "string" ? raw.text : "",
    type: messageType,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : undefined,
    storagePath: typeof raw.storagePath === "string" ? raw.storagePath : undefined,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? undefined,
    deletedAt: raw.deletedAt ?? undefined,
    status: "sent",
  };
}

export async function ensureGeneralChat(orgId: string): Promise<void> {
  requireUid();
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return;

  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/general`);
  const snap = await getDoc(chatRef);
  if (snap.exists()) return;

  await setDoc(chatRef, {
    orgId: normalizedOrgId,
    type: "general",
    title: "General",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageText: "",
    lastMessageAt: serverTimestamp(),
    lastMessageByUid: null,
  });
}

export function listenBusinessChats(
  orgId: string,
  callback: (chats: BusinessChatDoc[]) => void,
  onError?: (error: Error) => void
): () => void {
  const normalizedOrgId = orgId.trim();
  const chatsRef = collection(db, `organizations/${normalizedOrgId}/chats`);
  const q = query(chatsRef, orderBy("lastMessageAt", "desc"), limit(30));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d: { id: string; data: () => unknown }) =>
        toChatDoc(d.id, (d.data() ?? {}) as Record<string, unknown>)
      );
      callback(rows);
    },
    onError
  );
}

export function listenChatMessages(
  orgId: string,
  chatId: string,
  callback: (messages: BusinessChatMessageDoc[]) => void,
  onError?: (error: Error) => void
): () => void {
  const messagesRef = collection(db, `organizations/${orgId}/chats/${chatId}/messages`);
  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(250));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d: { id: string; data: () => unknown }) =>
        toMessageDoc(d.id, (d.data() ?? {}) as Record<string, unknown>)
      );
      callback(rows);
    },
    onError
  );
}

const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;

export async function sendImageMessage(input: {
  orgId: string;
  chatId: string;
  localUri: string;
  mimeType?: string;
}): Promise<void> {
  const uid = requireUid();
  const authUser = getAuth()?.currentUser ?? null;
  const mimeType = input.mimeType?.trim() || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : "jpg";

  const response = await fetch(input.localUri);
  const blob = await response.blob();
  if (blob.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("Image is too large (max 15 MB).");
  }

  await ensureGeneralChat(input.orgId);

  const fileName = `${uid}_${Date.now()}.${ext}`;
  const storagePath = `organizations/${input.orgId}/chats/${input.chatId}/messages/${fileName}`;
  const storageInstance = getStorage();
  if (!storageInstance) {
    throw new Error("Firebase Storage is not available.");
  }
  const storageRef = storageInstance.ref(storagePath);
  await storageRef.putFile(input.localUri, { contentType: mimeType });
  const imageUrl = await storageRef.getDownloadURL();

  const messagesRef = collection(db, `organizations/${input.orgId}/chats/${input.chatId}/messages`);
  await addDoc(messagesRef, {
    orgId: input.orgId,
    chatId: input.chatId,
    senderUid: uid,
    senderName: authUser?.displayName ?? authUser?.email ?? uid,
    senderEmail: authUser?.email ?? "",
    text: "",
    type: "image",
    imageUrl,
    storagePath,
    createdAt: serverTimestamp(),
    status: "sent",
  });

  const chatRef = doc(db, `organizations/${input.orgId}/chats/${input.chatId}`);
  await updateDoc(chatRef, {
    updatedAt: serverTimestamp(),
    lastMessageText: "📷",
    lastMessageAt: serverTimestamp(),
    lastMessageByUid: uid,
  });
}

export async function sendTextMessage(input: { orgId: string; chatId: string; text: string }): Promise<void> {
  const uid = requireUid();
  const authUser = getAuth()?.currentUser ?? null;
  const text = input.text.trim();
  if (!text) return;

  await ensureGeneralChat(input.orgId);

  const messagesRef = collection(db, `organizations/${input.orgId}/chats/${input.chatId}/messages`);
  await addDoc(messagesRef, {
    orgId: input.orgId,
    chatId: input.chatId,
    senderUid: uid,
    senderName: authUser?.displayName ?? authUser?.email ?? uid,
    senderEmail: authUser?.email ?? "",
    text,
    type: "text",
    createdAt: serverTimestamp(),
    status: "sent",
  });

  const chatRef = doc(db, `organizations/${input.orgId}/chats/${input.chatId}`);
  await updateDoc(chatRef, {
    updatedAt: serverTimestamp(),
    lastMessageText: text,
    lastMessageAt: serverTimestamp(),
    lastMessageByUid: uid,
  });
}

export async function markChatRead(input: { orgId: string; chatId: string }): Promise<void> {
  const uid = requireUid();
  const readRef = doc(db, `organizations/${input.orgId}/chats/${input.chatId}/reads/${uid}`);
  await setDoc(
    readRef,
    {
      uid,
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function toMillis(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof raw === "object" && raw !== null) {
    const maybe = raw as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      const parsed = maybe.toDate().getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

export async function getUnreadChatCount(orgId: string, uid: string): Promise<number> {
  if (!orgId || !uid) return 0;
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return 0;

  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/general`);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) {
    return 0;
  }

  const readRef = doc(db, `organizations/${normalizedOrgId}/chats/general/reads/${uid}`);
  const readSnap = await getDoc(readRef);
  const lastReadAtMs = toMillis(readSnap.data()?.lastReadAt);

  const messagesRef = collection(db, `organizations/${normalizedOrgId}/chats/general/messages`);
  const q =
    lastReadAtMs > 0
      ? query(messagesRef, where("createdAt", ">", new Date(lastReadAtMs)), orderBy("createdAt", "desc"), limit(100))
      : query(messagesRef, orderBy("createdAt", "desc"), limit(60));
  const snap = await getDocs(q);

  let unread = 0;
  for (const d of snap.docs) {
    const row = (d.data() ?? {}) as Record<string, unknown>;
    if (row.deletedAt) continue;
    if (typeof row.senderUid === "string" && row.senderUid === uid) continue;
    unread += 1;
    if (unread >= 99) break;
  }
  return unread;
}
