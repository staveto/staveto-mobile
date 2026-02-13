import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizePhone(input: string, defaultRegion: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const parsed = parsePhoneNumberFromString(raw, defaultRegion as any);
  if (parsed && parsed.isValid()) {
    return parsed.number;
  }
  return raw.replace(/[^\d+]/g, "");
}
