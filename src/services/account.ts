import { getCallable } from "../firebase";

export async function requestAccountDeletion(reason?: string): Promise<{ status: string }> {
  const result = await getCallable("requestAccountDeletion")({ reason });
  return result.data as { status: string };
}
