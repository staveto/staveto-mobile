export function toMillis(raw: unknown): number {
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

export function formatChatListTime(raw: unknown): string {
  const ms = toMillis(raw);
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString();
}

export function formatMessageTime(raw: unknown): string {
  const ms = toMillis(raw);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Deterministic DM chat id for two org member uids. */
export function buildDirectChatId(uidA: string, uidB: string): string {
  return `direct_${[uidA.trim(), uidB.trim()].sort().join("_")}`;
}

export function sortedParticipantUids(uidA: string, uidB: string): [string, string] {
  return [uidA.trim(), uidB.trim()].sort() as [string, string];
}
