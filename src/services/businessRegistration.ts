import { getCallable } from "../firebase";

export type CreateBusinessOrgInput = {
  planCode: "business_starter" | "business_team" | "business_company";
  billingPeriod: "monthly" | "yearly";
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
  try {
    console.log("[businessRegistration] createBusinessOrg callable start");
    const callable = getCallable("createBusinessOrg");
    const result = await callable(input);
    const data = (result as { data?: CreateBusinessOrgResult })?.data;
    if (!data || data.ok !== true || typeof data.orgId !== "string" || typeof data.orderId !== "string") {
      throw new Error("Neplatná odpoveď servera pre createBusinessOrg.");
    }
    console.log("[businessRegistration] createBusinessOrg callable success");
    return data;
  } catch (error) {
    const errorCode =
      typeof (error as { code?: unknown } | null)?.code === "string"
        ? ((error as { code: string }).code as string)
        : "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("[businessRegistration] createBusinessOrg callable error", {
      code: errorCode,
      message: errorMessage,
    });
    throw error;
  }
}

