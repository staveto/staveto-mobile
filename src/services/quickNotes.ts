/**
 * Quick notes – capture now, process later (inbox).
 * Stored locally in AsyncStorage (per user).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy";

const STORAGE_KEY = "@staveto:quickNotes";

export type QuickNoteAttachment = {
  uri: string;
  kind: "image" | "video";
};

export type QuickNoteStatus = "open" | "processed" | "archived";

export type QuickNoteSourceScreen = "home" | "inbox" | "mobile_launcher" | "unknown";

export type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  dateYmd: string;
  attachments?: QuickNoteAttachment[];
  /** Inbox workflow */
  status: QuickNoteStatus;
  /** Where the note was captured */
  sourceScreen: QuickNoteSourceScreen;
  /** User id (redundant with storage key, useful if data is ever merged) */
  createdByUserId?: string;
  createdByName?: string | null;
  /** Business org when captured from field launcher */
  orgId?: string | null;
  /** Optional linked task (e.g. active timer task) */
  taskId?: string | null;
  /** Employee opted to share with manager */
  shareWithManager?: boolean;
  /** Confirmed project (after user assigns) */
  sourceProjectId?: string | null;
  sourceProjectName?: string | null;
  /** Hint only – e.g. last opened project at capture time; not authoritative */
  suggestedProjectId?: string | null;
  suggestedProjectName?: string | null;
  /** Optional capture position if available */
  latitude?: number | null;
  longitude?: number | null;
};

export type QuickNoteCaptureMeta = {
  sourceScreen: QuickNoteSourceScreen;
  createdByUserId?: string;
  createdByName?: string | null;
  orgId?: string | null;
  taskId?: string | null;
  shareWithManager?: boolean;
  suggestedProjectId?: string | null;
  suggestedProjectName?: string | null;
  /** Confirmed project at capture (field launcher) */
  sourceProjectId?: string | null;
  sourceProjectName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

function migrateNote(raw: Record<string, unknown>): QuickNote {
  const id = String(raw.id ?? "");
  const text = String(raw.text ?? "");
  const createdAt = String(raw.createdAt ?? new Date().toISOString());
  const dateYmd = String(raw.dateYmd ?? createdAt.split("T")[0]);
  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as QuickNoteAttachment[]) : undefined;
  const status = (raw.status as QuickNoteStatus) === "processed" || (raw.status as QuickNoteStatus) === "archived"
    ? (raw.status as QuickNoteStatus)
    : "open";
  const sourceScreen: QuickNoteSourceScreen =
    raw.sourceScreen === "home" ||
    raw.sourceScreen === "inbox" ||
    raw.sourceScreen === "mobile_launcher"
      ? raw.sourceScreen
      : "unknown";
  return {
    id,
    text,
    createdAt,
    dateYmd,
    attachments,
    status,
    sourceScreen,
    createdByUserId: typeof raw.createdByUserId === "string" ? raw.createdByUserId : undefined,
    createdByName: typeof raw.createdByName === "string" ? raw.createdByName : null,
    orgId: typeof raw.orgId === "string" ? raw.orgId : null,
    taskId: typeof raw.taskId === "string" ? raw.taskId : null,
    shareWithManager: raw.shareWithManager === true,
    sourceProjectId: raw.sourceProjectId != null ? (raw.sourceProjectId as string | null) : null,
    sourceProjectName: raw.sourceProjectName != null ? (raw.sourceProjectName as string | null) : null,
    suggestedProjectId: raw.suggestedProjectId != null ? (raw.suggestedProjectId as string | null) : null,
    suggestedProjectName: raw.suggestedProjectName != null ? (raw.suggestedProjectName as string | null) : null,
    latitude: typeof raw.latitude === "number" && Number.isFinite(raw.latitude) ? raw.latitude : null,
    longitude: typeof raw.longitude === "number" && Number.isFinite(raw.longitude) ? raw.longitude : null,
  };
}

async function loadAll(userId: string): Promise<QuickNote[]> {
  const raw = await AsyncStorage.getItem(getStorageKey(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map((x) => migrateNote(x));
  } catch {
    return [];
  }
}

async function saveAll(userId: string, notes: QuickNote[]): Promise<void> {
  await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(notes));
}

function toYmd(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Skopíruje súbor do app adresára, aby prežil reštart (content:// na Androide). */
export async function persistQuickNoteMedia(uri: string, kind: "image" | "video"): Promise<string> {
  const base = documentDirectory;
  if (!base) return uri;
  const destDir = `${base}quicknotes/`;
  try {
    const info = await getInfoAsync(destDir);
    if (!info.exists) await makeDirectoryAsync(destDir, { intermediates: true });
  } catch {
    return uri;
  }
  const ext = kind === "video" ? "mp4" : "jpg";
  const dest = `${destDir}qn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
  try {
    await copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

export type AddQuickNoteResult = {
  note: QuickNote;
  /** When shareWithManager was on: true = synced + notified, false = failed. Otherwise null. */
  sharePublished: boolean | null;
};

/** Pridať rýchly zápis (inbox – status open) */
export async function addQuickNote(
  userId: string,
  text: string,
  attachments?: QuickNoteAttachment[],
  meta?: QuickNoteCaptureMeta
): Promise<AddQuickNoteResult> {
  const trimmed = text.trim();
  const hasAtt = attachments && attachments.length > 0;
  if (!trimmed && !hasAtt) throw new Error("Text nemôže byť prázdny");
  const now = new Date();
  const note: QuickNote = {
    id: `qn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    text: trimmed,
    createdAt: now.toISOString(),
    dateYmd: toYmd(now),
    ...(hasAtt ? { attachments } : {}),
    status: "open",
    sourceScreen: meta?.sourceScreen ?? "unknown",
    createdByUserId: meta?.createdByUserId ?? userId,
    createdByName: meta?.createdByName ?? null,
    orgId: meta?.orgId ?? null,
    taskId: meta?.taskId ?? null,
    shareWithManager: meta?.shareWithManager === true,
    sourceProjectId: meta?.sourceProjectId ?? null,
    sourceProjectName: meta?.sourceProjectName ?? null,
    suggestedProjectId: meta?.suggestedProjectId ?? null,
    suggestedProjectName: meta?.suggestedProjectName ?? null,
    latitude: meta?.latitude ?? null,
    longitude: meta?.longitude ?? null,
  };
  const notes = await loadAll(userId);
  notes.unshift(note);
  await saveAll(userId, notes);

  let sharePublished: boolean | null = null;
  if (note.shareWithManager) {
    const { publishSharedFieldNoteWithTimeout, resolveFieldNoteOrgId } = await import(
      "./sharedFieldNotes"
    );
    const resolvedOrgId = await resolveFieldNoteOrgId(note);
    if (resolvedOrgId && !note.orgId?.trim()) {
      note.orgId = resolvedOrgId;
      notes[0] = note;
      await saveAll(userId, notes);
    }
    sharePublished = await publishSharedFieldNoteWithTimeout(note);
  }

  return { note, sharePublished };
}

/** Zápisky pre dátum alebo všetky */
export async function listQuickNotes(userId: string, dateYmd?: string): Promise<QuickNote[]> {
  const notes = await loadAll(userId);
  if (dateYmd) {
    return notes.filter((n) => n.dateYmd === dateYmd);
  }
  return notes;
}

export async function listTodayNotes(userId: string): Promise<QuickNote[]> {
  return listQuickNotes(userId, toYmd(new Date()));
}

/** Otvorené zápisky (na spracovanie), voliteľne len dnešné */
export async function listOpenQuickNotes(userId: string, opts?: { todayOnly?: boolean }): Promise<QuickNote[]> {
  const notes = await loadAll(userId);
  const open = notes.filter((n) => n.status === "open");
  if (opts?.todayOnly) {
    const y = toYmd(new Date());
    return open.filter((n) => n.dateYmd === y);
  }
  return open;
}

/** Počet otvorených zápisov (badge / Home) */
export async function getOpenQuickNotesCount(userId: string): Promise<number> {
  const notes = await loadAll(userId);
  return notes.filter((n) => n.status === "open").length;
}

/** @deprecated Prefer getOpenQuickNotesCount – dnešné všetky vs otvorené */
export async function getTodayNotesCount(userId: string): Promise<number> {
  const notes = await listTodayNotes(userId);
  return notes.filter((n) => n.status === "open").length;
}

export async function deleteQuickNote(userId: string, noteId: string): Promise<void> {
  const notes = await loadAll(userId);
  const note = notes.find((n) => n.id === noteId);
  if (note?.attachments?.length) {
    const docBase = documentDirectory;
    for (const a of note.attachments) {
      try {
        if (docBase && a.uri.startsWith(docBase)) {
          await deleteAsync(a.uri, { idempotent: true });
        }
      } catch {
        /* ignore */
      }
    }
  }
  const filtered = notes.filter((n) => n.id !== noteId);
  await saveAll(userId, filtered);
}

/** Upraviť text zápisku */
export async function updateQuickNote(userId: string, noteId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  const notes = await loadAll(userId);
  const existing = notes.find((n) => n.id === noteId);
  if (!existing) return;
  if (!trimmed && !(existing.attachments && existing.attachments.length > 0)) {
    throw new Error("Text nemôže byť prázdny");
  }
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  notes[idx] = { ...notes[idx], text: trimmed };
  await saveAll(userId, notes);
}

/** Priradiť / zmeniť projekt zápisu */
export async function assignQuickNoteToProject(
  userId: string,
  noteId: string,
  projectId: string,
  projectName: string | null
): Promise<void> {
  const notes = await loadAll(userId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  notes[idx] = {
    ...notes[idx],
    sourceProjectId: projectId,
    sourceProjectName: projectName,
  };
  await saveAll(userId, notes);
}

async function syncNoteStatusToFirestore(note: QuickNote, status: QuickNoteStatus): Promise<void> {
  if (!note.shareWithManager) return;
  const { syncSharedFieldNoteStatus, resolveFieldNoteOrgId } = await import("./sharedFieldNotes");
  const orgId = note.orgId?.trim() || (await resolveFieldNoteOrgId(note));
  if (!orgId) return;
  void syncSharedFieldNoteStatus(orgId, note.id, status);
}

export async function markQuickNoteProcessed(userId: string, noteId: string): Promise<void> {
  const notes = await loadAll(userId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  const prev = notes[idx];
  notes[idx] = { ...prev, status: "processed" };
  await saveAll(userId, notes);
  void syncNoteStatusToFirestore(prev, "processed");
}

export async function markQuickNoteArchived(userId: string, noteId: string): Promise<void> {
  const notes = await loadAll(userId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  const prev = notes[idx];
  notes[idx] = { ...prev, status: "archived" };
  await saveAll(userId, notes);
  void syncNoteStatusToFirestore(prev, "archived");
}

export async function reopenQuickNote(userId: string, noteId: string): Promise<void> {
  const notes = await loadAll(userId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  const prev = notes[idx];
  notes[idx] = { ...prev, status: "open" };
  await saveAll(userId, notes);
  void syncNoteStatusToFirestore(prev, "open");
}

/** Backfill: push open notes on business projects to Firestore (manager dashboard). */
export async function syncOpenBusinessFieldNotesToFirestore(userId: string): Promise<number> {
  const notes = await loadAll(userId);
  const { getProject, isBusinessTeamProject } = await import("./projects");
  const { publishSharedFieldNoteWithTimeout, resolveFieldNoteOrgId } = await import(
    "./sharedFieldNotes"
  );

  let synced = 0;
  let changed = false;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.status !== "open") continue;

    const projectId = note.sourceProjectId ?? note.suggestedProjectId ?? null;
    if (!projectId) continue;

    const project = await getProject(projectId).catch(() => null);
    if (!project || !isBusinessTeamProject(project)) continue;

    let next = note;
    if (!note.shareWithManager || !note.orgId?.trim()) {
      next = {
        ...note,
        shareWithManager: true,
        orgId: note.orgId?.trim() || project.orgId?.trim() || null,
      };
      notes[i] = next;
      changed = true;
    }

    const orgId = await resolveFieldNoteOrgId(next);
    if (!orgId) continue;
    if (!next.orgId?.trim()) {
      next = { ...next, orgId };
      notes[i] = next;
      changed = true;
    }

    const ok = await publishSharedFieldNoteWithTimeout(next, 8000);
    if (ok) synced += 1;
  }

  if (changed) await saveAll(userId, notes);
  return synced;
}
