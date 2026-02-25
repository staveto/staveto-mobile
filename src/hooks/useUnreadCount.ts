import { useUnreadCountContext } from "../context/UnreadCountContext";

/**
 * Returns total count of items needing attention: unread notifications + pending project invites.
 * Used for badge on Notifications tab and drawer nav item.
 * Reads from shared UnreadCountContext.
 */
export function useUnreadCount(): { count: number; loading: boolean; refresh: () => Promise<void> } {
  const { count, loading, refresh } = useUnreadCountContext();
  return { count, loading, refresh };
}
