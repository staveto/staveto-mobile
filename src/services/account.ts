import { functions } from "../firebase";

export async function requestAccountDeletion(reason?: string): Promise<{ status: string }> {
  const fn = functions().httpsCallable("requestAccountDeletion");
  const result = await fn({ reason });
  return result.data;
}
