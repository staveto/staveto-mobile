import { getAuth, db, getStorage, getCallable } from "../firebase";
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
import {
  buildDirectChatId,
  sortedParticipantUids,
  toMillis,
} from "../lib/businessChatUtils";

export type BusinessChatType = "general" | "direct";
export type BusinessChatMessageType = "text" | "image";

export type BusinessChatDoc = {
  id: string;
  orgId: string;
  type: BusinessChatType;
  title: string;
  participantUids?: string[];
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

const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;

export async function healOrgAccessForChat(orgId: string): Promise<boolean> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return false;

  if (await ensureMyOrgMemberIndex(normalizedOrgId)) return true;

  const healTimeout = { timeoutMs: 30000 };
  try {
    const syncHeal = getCallable<
      { orgId: string; healOnly: boolean },
      { data?: { healed?: boolean; orgHealed?: boolean } }
    >("syncMyProjectAssignmentNotifications", healTimeout);
    await syncHeal({ orgId: normalizedOrgId, healOnly: true });
  } catch {
    /* Best effort — verify index below. */
  }

  return ensureMyOrgMemberIndex(normalizedOrgId);
}

export async function ensureMyOrgMemberIndex(orgId: string): Promise<boolean> {
  const normalizedOrgId = orgId.trim();
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!normalizedOrgId || !uid) return false;

  const healTimeout = { timeoutMs: 30000 };

  try {
    const listOrgs = getCallable<{ orgId?: string }, { data?: { organizations?: unknown[] } }>(
      "listMyBusinessOrganizations",
      healTimeout
    );
    await listOrgs({ orgId: normalizedOrgId });
  } catch {
    /* Fall through to dedicated heal callable when deployed. */
  }

  try {
    const heal = getCallable<{ orgId: string }, { data?: { ok?: boolean; healed?: boolean } }>(
      "ensureMyOrgMemberIndex",
      healTimeout
    );
    await heal({ orgId: normalizedOrgId });
  } catch {
    /* Callable may be unavailable; verify index doc below. */
  }

  try {
    const memberRef = doc(db, `organizations/${normalizedOrgId}/members/${uid}`);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) return true;
  } catch {
    /* verify failed */
  }

  return false;
}

function requireUid(): string {
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!uid) {
    throw new Error("Musíte byť prihlásený.");
  }
  return uid;
}

function toChatDoc(id: string, raw: Record<string, unknown>): BusinessChatDoc {
  const chatType: BusinessChatType = raw.type === "direct" ? "direct" : "general";
  const participantUids = Array.isArray(raw.participantUids)
    ? raw.participantUids.filter((u): u is string => typeof u === "string")
    : undefined;

  return {
    id,
    orgId: typeof raw.orgId === "string" ? raw.orgId : "",
    type: chatType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "General",
    participantUids,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    lastMessageText: typeof raw.lastMessageText === "string" ? raw.lastMessageText : "",
    lastMessageAt: raw.lastMessageAt ?? null,
    lastMessageByUid: typeof raw.lastMessageByUid === "string" ? raw.lastMessageByUid : null,
  };
}

export function getOtherParticipantUid(
  chat: Pick<BusinessChatDoc, "type" | "participantUids">,
  currentUid: string
): string | null {
  if (chat.type !== "direct" || !chat.participantUids?.length) return null;
  return chat.participantUids.find((u) => u !== currentUid) ?? null;
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

export async function ensureDirectChat(input: {
  orgId: string;
  otherUid: string;
  otherDisplayName: string;
}): Promise<BusinessChatDoc> {
  const uid = requireUid();
  const normalizedOrgId = input.orgId.trim();
  const otherUid = input.otherUid.trim();
  if (!normalizedOrgId || !otherUid) throw new Error("Invalid chat participants");
  if (otherUid === uid) throw new Error("Cannot start a chat with yourself");

  await ensureMyOrgMemberIndex(normalizedOrgId);

  const chatId = buildDirectChatId(uid, otherUid);
  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/${chatId}`);
  const snap = await getDoc(chatRef);
  if (snap.exists()) {
    return toChatDoc(snap.id, snap.data() as Record<string, unknown>);
  }

  const participantUids = sortedParticipantUids(uid, otherUid);
  const title = input.otherDisplayName.trim() || otherUid;

  await setDoc(chatRef, {
    orgId: normalizedOrgId,
    type: "direct",
    participantUids,
    title,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageText: "",
    lastMessageAt: serverTimestamp(),
    lastMessageByUid: null,
  });

  const created = await getDoc(chatRef);
  return toChatDoc(
    chatId,
    (created.data() ?? {
      orgId: normalizedOrgId,
      type: "direct",
      participantUids,
      title,
    }) as Record<string, unknown>
  );
}

async function ensureChatExists(orgId: string, chatId: string): Promise<void> {
  if (chatId === "general") {
    await ensureGeneralChat(orgId);
    return;
  }
  if (!chatId.startsWith("direct_")) return;
  const snap = await getDoc(doc(db, `organizations/${orgId}/chats/${chatId}`));
  if (!snap.exists()) throw new Error("Chat not found");
}

export async function ensureGeneralChat(orgId: string): Promise<void> {
  requireUid();
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return;

  await ensureMyOrgMemberIndex(normalizedOrgId);

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

function listenDirectChatDoc(
  orgId: string,
  chatId: string,
  callback: (chat: BusinessChatDoc | null) => void
): () => void {
  const chatRef = doc(db, `organizations/${orgId}/chats/${chatId}`);
  return onSnapshot(
    chatRef,
    (snap: { exists: () => boolean; id: string; data: () => unknown }) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const chat = toChatDoc(snap.id, (snap.data() ?? {}) as Record<string, unknown>);
      callback(chat.type === "direct" ? chat : null);
    },
    () => callback(null)
  );
}

function mergeDirectChats(
  queryRows: BusinessChatDoc[],
  docRows: Map<string, BusinessChatDoc>
): BusinessChatDoc[] {
  const byId = new Map<string, BusinessChatDoc>();
  for (const chat of queryRows) byId.set(chat.id, chat);
  for (const [id, chat] of docRows) byId.set(id, chat);
  return [...byId.values()];
}

export function listenBusinessChats(
  orgId: string,
  uid: string,
  callback: (chats: BusinessChatDoc[]) => void,
  onError?: (error: Error) => void,
  options?: { teamMemberUids?: string[] }
): () => void {
  const normalizedOrgId = orgId.trim();
  let generalChat: BusinessChatDoc | null = null;
  let queryDirectChats: BusinessChatDoc[] = [];
  const docDirectChats = new Map<string, BusinessChatDoc>();

  const emit = () => {
    const directChats = mergeDirectChats(queryDirectChats, docDirectChats);
    const rows = [...(generalChat ? [generalChat] : []), ...directChats].sort(
      (a, b) => toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt)
    );
    callback(rows);
  };

  const unsubGeneral = listenGeneralBusinessChat(
    normalizedOrgId,
    (chat) => {
      generalChat = chat;
      emit();
    },
    onError
  );

  const directQ = query(
    collection(db, `organizations/${normalizedOrgId}/chats`),
    where("participantUids", "array-contains", uid)
  );
  const unsubDirect = onSnapshot(
    directQ,
    (snap) => {
      queryDirectChats = snap.docs
        .map((d: { id: string; data: () => unknown }) =>
          toChatDoc(d.id, (d.data() ?? {}) as Record<string, unknown>)
        )
        .filter((chat) => chat.type === "direct");
      emit();
    },
    () => {
      // Collection query may fail on some devices — per-doc team listeners still deliver DMs.
      queryDirectChats = [];
      emit();
    }
  );

  const teamUnsubs = (options?.teamMemberUids ?? [])
    .map((otherUid) => otherUid.trim())
    .filter((otherUid) => otherUid && otherUid !== uid)
    .map((otherUid) => {
      const chatId = buildDirectChatId(uid, otherUid);
      return listenDirectChatDoc(normalizedOrgId, chatId, (chat) => {
        if (chat) docDirectChats.set(chatId, chat);
        else docDirectChats.delete(chatId);
        emit();
      });
    });

  return () => {
    unsubGeneral();
    unsubDirect();
    for (const unsub of teamUnsubs) unsub();
  };
}

/** Subscribe to the team `general` chat document (avoids collection-query rule edge cases). */
export function listenGeneralBusinessChat(
  orgId: string,
  callback: (chat: BusinessChatDoc | null) => void,
  onError?: (error: Error) => void
): () => void {
  const normalizedOrgId = orgId.trim();
  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/general`);
  return onSnapshot(
    chatRef,
    (snap: { exists: () => boolean; id: string; data: () => unknown }) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      callback(toChatDoc(snap.id, (snap.data() ?? {}) as Record<string, unknown>));
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

  await ensureChatExists(input.orgId, input.chatId);

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

  await ensureChatExists(input.orgId, input.chatId);

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

export async function getUnreadCountForChat(
  orgId: string,
  uid: string,
  chatId: string
): Promise<number> {
  if (!orgId || !uid || !chatId) return 0;
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return 0;

  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/${chatId}`);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) return 0;

  const readRef = doc(db, `organizations/${normalizedOrgId}/chats/${chatId}/reads/${uid}`);
  const readSnap = await getDoc(readRef);
  const lastReadAtMs = toMillis(readSnap.data()?.lastReadAt);

  const messagesRef = collection(db, `organizations/${normalizedOrgId}/chats/${chatId}/messages`);
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

/** Total unread across general + all direct chats for the signed-in user. */
export async function getUnreadChatCount(orgId: string, uid: string): Promise<number> {
  if (!orgId || !uid) return 0;
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return 0;

  const chatIds = new Set<string>(["general"]);

  try {
    const directQ = query(
      collection(db, `organizations/${normalizedOrgId}/chats`),
      where("participantUids", "array-contains", uid)
    );
    const directSnap = await getDocs(directQ);
    for (const d of directSnap.docs) {
      if (d.id !== "general") chatIds.add(d.id);
    }
  } catch {
    /* Direct chat list is best-effort for the badge. */
  }

  try {
    const team = await import("./businessChatTeam").then((m) => m.listChatTeamMembers(normalizedOrgId, uid));
    for (const member of team) {
      chatIds.add(buildDirectChatId(uid, member.uid));
    }
  } catch {
    /* Team-based DM ids are best-effort. */
  }

  let total = 0;
  for (const chatId of chatIds) {
    total += await getUnreadCountForChat(normalizedOrgId, uid, chatId);
    if (total >= 99) return 99;
  }
  return total;
}
