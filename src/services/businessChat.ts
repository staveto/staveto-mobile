import { getAuth, db } from "../firebase";
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
import { getMembership, getOrganization } from "./organizations";
import type { MembershipDoc, OrgRole } from "./organizations";

export type BusinessChatType = "general" | "direct";
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
  participantUids?: string[];
};

export type BusinessChatMemberDoc = {
  id: string;
  orgId: string;
  uid: string;
  displayName: string;
  email: string;
  role: OrgRole;
  status: MembershipDoc["status"];
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

const CHAT_WRITER_ROLES = new Set(["owner", "admin", "manager", "worker"]);

function requireUid(): string {
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!uid) {
    throw new Error("Musíte byť prihlásený.");
  }
  return uid;
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

function hasPendingTrialAccess(org: { status?: string; trialEndsAt?: unknown; businessEnabled?: boolean; activeBusinessOrderId?: string | null }): boolean {
  if (org.status !== "pending_payment") return false;
  const trialEndsAtMs = toMillis(org.trialEndsAt);
  const trialValid = trialEndsAtMs > Date.now();
  return trialValid || org.businessEnabled === true || !!org.activeBusinessOrderId;
}

async function resolveBusinessChatAccess(orgId: string): Promise<{ uid: string; role: OrgRole; canRead: boolean; canWrite: boolean }> {
  const uid = requireUid();
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return { uid, role: "viewer", canRead: false, canWrite: false };

  const [organization, membership] = await Promise.all([
    getOrganization(normalizedOrgId),
    getMembership(normalizedOrgId, uid),
  ]);
  if (!organization || !membership) {
    return { uid, role: "viewer", canRead: false, canWrite: false };
  }
  if (membership.status !== "active") {
    return { uid, role: membership.role, canRead: false, canWrite: false };
  }
  const statusCanAccess =
    organization.status === "active" ||
    organization.status === "trialing" ||
    hasPendingTrialAccess(organization);
  const canRead = statusCanAccess;
  const canWrite = canRead && CHAT_WRITER_ROLES.has(membership.role);
  return { uid, role: membership.role, canRead, canWrite };
}

function memberNameFromRaw(raw: Record<string, unknown>, fallbackUid: string): string {
  const fromDisplayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  if (fromDisplayName) return fromDisplayName;
  const fromName = typeof raw.name === "string" ? raw.name.trim() : "";
  if (fromName) return fromName;
  const fromEmail = typeof raw.email === "string" ? raw.email.trim() : "";
  if (fromEmail) return fromEmail;
  const fromEmailLower = typeof raw.emailLower === "string" ? raw.emailLower.trim() : "";
  if (fromEmailLower) return fromEmailLower;
  if (fallbackUid) return fallbackUid;
  return "User";
}

function localPart(email: string): string {
  const idx = email.indexOf("@");
  if (idx <= 0) return email;
  return email.slice(0, idx);
}

export function buildDirectChatId(uidA: string, uidB: string): string {
  const a = uidA.trim();
  const b = uidB.trim();
  if (!a || !b) return "direct_";
  const [minUid, maxUid] = a < b ? [a, b] : [b, a];
  return `direct_${minUid}_${maxUid}`;
}

async function canAccessDirectChat(orgId: string, chatId: string, uid: string, role: OrgRole): Promise<boolean> {
  const chatRef = doc(db, `organizations/${orgId}/chats/${chatId}`);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) return false;
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  if (raw.type !== "direct") return false;
  const participants = Array.isArray(raw.participantUids)
    ? raw.participantUids.filter((item): item is string => typeof item === "string")
    : [];
  if (participants.includes(uid)) return true;
  return role === "owner" || role === "admin";
}

function toChatDoc(id: string, raw: Record<string, unknown>): BusinessChatDoc {
  const participantUids = Array.isArray(raw.participantUids)
    ? raw.participantUids.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  return {
    id,
    orgId: typeof raw.orgId === "string" ? raw.orgId : "",
    type: raw.type === "direct" ? "direct" : "general",
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "General",
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    lastMessageText: typeof raw.lastMessageText === "string" ? raw.lastMessageText : "",
    lastMessageAt: raw.lastMessageAt ?? null,
    lastMessageByUid: typeof raw.lastMessageByUid === "string" ? raw.lastMessageByUid : null,
    participantUids,
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
  const access = await resolveBusinessChatAccess(orgId);
  if (!access.canRead) {
    throw new Error("business-chat/no-access");
  }
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

export async function ensureDirectChat(orgId: string, otherUserId: string): Promise<string> {
  const access = await resolveBusinessChatAccess(orgId);
  if (!access.canRead) {
    throw new Error("business-chat/no-access");
  }
  const normalizedOrgId = orgId.trim();
  const targetUid = otherUserId.trim();
  if (!normalizedOrgId || !targetUid) {
    throw new Error("business-chat/no-access");
  }
  if (targetUid === access.uid) {
    return buildDirectChatId(access.uid, targetUid);
  }

  const targetMembership = await getMembership(normalizedOrgId, targetUid);
  if (!targetMembership || targetMembership.status !== "active") {
    throw new Error("business-chat/no-access");
  }

  const chatId = buildDirectChatId(access.uid, targetUid);
  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/${chatId}`);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      orgId: normalizedOrgId,
      type: "direct",
      participantUids: [access.uid, targetUid].sort(),
      title: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageText: "",
      lastMessageAt: null,
      lastMessageByUid: null,
    });
  }
  return chatId;
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

export function listenBusinessChatMembers(
  orgId: string,
  callback: (members: BusinessChatMemberDoc[]) => void,
  onError?: (error: Error) => void
): () => void {
  const normalizedOrgId = orgId.trim();
  const membersRef = collection(db, `organizations/${normalizedOrgId}/members`);
  const q = query(membersRef, where("status", "==", "active"), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const rows: BusinessChatMemberDoc[] = snap.docs
        .map((d: { id: string; data: () => unknown }) => {
          const raw = (d.data() ?? {}) as Record<string, unknown>;
          const uid =
            (typeof raw.userId === "string" && raw.userId.trim()) ||
            (typeof raw.uid === "string" && raw.uid.trim()) ||
            d.id;
          const email = (typeof raw.email === "string" ? raw.email.trim() : "") ||
            (typeof raw.emailLower === "string" ? raw.emailLower.trim() : "");
          const displayNameRaw = memberNameFromRaw(raw, uid);
          const displayName = email && (displayNameRaw === email || displayNameRaw === (raw.emailLower ?? ""))
            ? localPart(email)
            : displayNameRaw;
          const roleRaw = typeof raw.role === "string" ? raw.role.toLowerCase() : "viewer";
          const role: OrgRole =
            roleRaw === "owner" || roleRaw === "admin" || roleRaw === "manager" || roleRaw === "worker"
              ? roleRaw
              : "viewer";
          return {
            id: d.id,
            orgId: normalizedOrgId,
            uid,
            displayName,
            email,
            role,
            status: "active" as const,
          };
        })
        .filter((row: BusinessChatMemberDoc) => row.uid.trim().length > 0);
      rows.sort((a: BusinessChatMemberDoc, b: BusinessChatMemberDoc) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
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

export async function sendTextMessage(input: { orgId: string; chatId: string; text: string }): Promise<void> {
  const access = await resolveBusinessChatAccess(input.orgId);
  if (!access.canWrite) {
    throw new Error("business-chat/write-not-allowed");
  }
  const uid = access.uid;
  const authUser = getAuth()?.currentUser ?? null;
  const text = input.text.trim();
  if (!text) return;

  if (input.chatId === "general") {
    await ensureGeneralChat(input.orgId);
  } else {
    const directAllowed = await canAccessDirectChat(input.orgId, input.chatId, uid, access.role);
    if (!directAllowed) {
      throw new Error("business-chat/no-access");
    }
  }

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
  const access = await resolveBusinessChatAccess(input.orgId);
  if (!access.canRead) {
    return;
  }
  if (input.chatId !== "general") {
    const directAllowed = await canAccessDirectChat(input.orgId, input.chatId, access.uid, access.role);
    if (!directAllowed) return;
  }
  const uid = access.uid;
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

export async function getUnreadChatCount(orgId: string, uid: string): Promise<number> {
  return getUnreadChatCountForChat(orgId, "general", uid);
}

export async function getUnreadChatCountForChat(orgId: string, chatId: string, uid: string): Promise<number> {
  if (!orgId || !uid) return 0;
  const access = await resolveBusinessChatAccess(orgId);
  if (!access.canRead || access.uid !== uid) return 0;
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return 0;
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) return 0;
  if (normalizedChatId !== "general") {
    const directAllowed = await canAccessDirectChat(normalizedOrgId, normalizedChatId, access.uid, access.role);
    if (!directAllowed) return 0;
  }

  const chatRef = doc(db, `organizations/${normalizedOrgId}/chats/${normalizedChatId}`);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) {
    return 0;
  }

  const readRef = doc(db, `organizations/${normalizedOrgId}/chats/${normalizedChatId}/reads/${uid}`);
  const readSnap = await getDoc(readRef);
  const lastReadAtMs = toMillis(readSnap.data()?.lastReadAt);

  const messagesRef = collection(db, `organizations/${normalizedOrgId}/chats/${normalizedChatId}/messages`);
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
