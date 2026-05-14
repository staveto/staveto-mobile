import { getCallable } from "../firebase";

export type CreateBusinessOrgInput = {
  companyName: string;
  legalName: string;
  countryCode: string;
  billingEmail: string;
  requestedSeats: number;
  billingAddress: {
    line1: string;
    line2?: string | null;
    city: string;
    zip: string;
  };
  companyIdentifiers?: {
    registrationNumber?: string | null;
    taxId?: string | null;
    vatId?: string | null;
  };
  contactName?: string | null;
  phone?: string | null;
};

export type CreateBusinessOrgResult = {
  ok: true;
  orgId: string;
  orderId: string;
  orderNumber: string;
  variableSymbol: string;
  paymentReference: string;
  status: "pending_payment";
};

export async function createBusinessOrg(
  input: CreateBusinessOrgInput
): Promise<CreateBusinessOrgResult> {
  const callable = getCallable("createBusinessOrg");
  const result = await callable(input);
  const data = (result as { data?: CreateBusinessOrgResult })?.data;
  if (!data || data.ok !== true || typeof data.orgId !== "string" || typeof data.orderId !== "string") {
    throw new Error("Neplatná odpoveď servera pre createBusinessOrg.");
  }
  return data;
}

