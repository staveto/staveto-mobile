import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export async function requestAccountDeletion(reason?: string): Promise<{ status: string }> {
  const fn = httpsCallable<{ reason?: string }, { status: string }>(functions, "requestAccountDeletion");
  const result = await fn({ reason });
  return result.data;
}
