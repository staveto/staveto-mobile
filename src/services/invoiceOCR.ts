import { functions } from "../firebase";

export type OcrStatus = "success" | "failed" | "limit";

export type OcrParsed = {
  supplierName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: "EUR";
};

export type OcrResult = {
  status: OcrStatus;
  parsed: OcrParsed | null;
  rawText?: string;
};

export async function extractInvoiceData(input: {
  storagePath: string;
  attachmentId?: string;
}): Promise<OcrResult> {
  const fn = functions().httpsCallable("extractInvoiceData");
  const result = await fn(input);
  const data = result?.data as OcrResult | undefined;
  if (!data || !data.status) {
    return { status: "failed", parsed: null };
  }
  return data;
}
