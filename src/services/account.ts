import { getFns } from "../firebase";

export async function requestAccountDeletion(reason?: string): Promise<{ status: string }> {
  const result = await getFns().httpsCallable("requestAccountDeletion")({ reason });
  return result.data as { status: string };
}
