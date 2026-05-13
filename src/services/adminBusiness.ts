import { getCallable } from "../firebase";

export type AdminActivateBusinessInput = {
  orgId: string;
  seatsLimit: number;
};

export type AdminActivateBusinessResult = {
  ok: true;
  status: "activated" | "already_active";
  orgId: string;
  seatsLimit: number;
  message?: string;
};

export async function adminActivateBusinessOrg(
  input: AdminActivateBusinessInput
): Promise<AdminActivateBusinessResult> {
  const orgId = input.orgId.trim();
  if (!orgId) {
    throw new Error("Chýba ID organizácie.");
  }
  if (!Number.isInteger(input.seatsLimit) || input.seatsLimit < 1) {
    throw new Error("seatsLimit musí byť celé číslo >= 1.");
  }

  const result = await getCallable("adminActivateBusinessOrg")({
    orgId,
    seatsLimit: input.seatsLimit,
  });
  const data = (result as { data?: AdminActivateBusinessResult })?.data;

  if (!data || data.ok !== true || typeof data.status !== "string") {
    throw new Error("Neplatná odpoveď servera pre adminActivateBusinessOrg.");
  }
  return data;
}
