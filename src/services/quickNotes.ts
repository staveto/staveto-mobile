/**
 * Quick notes – rýchle zápisky cez deň, večer spracovanie.
 * Ukladá sa lokálne v AsyncStorage (per user).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@staveto:quickNotes";

export type QuickNote = {
  id: string;
  text: string;
  createdAt: string; // ISO
  dateYmd: string; // YYYY-MM-DD
};

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

async function loadAll(userId: string): Promise<QuickNote[]> {
  const raw = await AsyncStorage.getItem(getStorageKey(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as QuickNote[];
    return Array.isArray(arr) ? arr : [];
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

/** Pridať rýchly zápis */
export async function addQuickNote(userId: string, text: string): Promise<QuickNote> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Text nemôže byť prázdny");
  const now = new Date();
  const note: QuickNote = {
    id: `qn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    text: trimmed,
    createdAt: now.toISOString(),
    dateYmd: toYmd(now),
  };
  const notes = await loadAll(userId);
  notes.unshift(note);
  await saveAll(userId, notes);
  return note;
}

/** Získať zápisky pre dátum (alebo všetky ak dateYmd je undefined) */
export async function listQuickNotes(userId: string, dateYmd?: string): Promise<QuickNote[]> {
  const notes = await loadAll(userId);
  if (dateYmd) {
    return notes.filter((n) => n.dateYmd === dateYmd);
  }
  return notes;
}

/** Získať zápisky pre dnešok */
export async function listTodayNotes(userId: string): Promise<QuickNote[]> {
  return listQuickNotes(userId, toYmd(new Date()));
}

/** Počet nezaradených zápisov pre dnešok (pre badge) */
export async function getTodayNotesCount(userId: string): Promise<number> {
  const notes = await listTodayNotes(userId);
  return notes.length;
}

/** Vymazať zápis */
export async function deleteQuickNote(userId: string, noteId: string): Promise<void> {
  const notes = await loadAll(userId);
  const filtered = notes.filter((n) => n.id !== noteId);
  await saveAll(userId, filtered);
}

/** Upraviť text zápisku */
export async function updateQuickNote(userId: string, noteId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Text nemôže byť prázdny");
  const notes = await loadAll(userId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return;
  notes[idx] = { ...notes[idx], text: trimmed };
  await saveAll(userId, notes);
}
