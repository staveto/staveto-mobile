import type { NewJobArchetype } from "./projectEnums";
import type { BusinessContact, BusinessContactType } from "../services/businessContacts";
import { patchProjectDocument } from "../services/projects";

export const CUSTOMER_FACING_JOB_ARCHETYPES: readonly NewJobArchetype[] = [
  "customer_job",
  "service_inspection",
  "large_construction_project",
] as const;

export function isCustomerFacingJobArchetype(
  archetype: NewJobArchetype | null | undefined
): boolean {
  if (!archetype) return false;
  return (CUSTOMER_FACING_JOB_ARCHETYPES as readonly string[]).includes(archetype);
}

export function defaultContactTypeForArchetype(
  _archetype: NewJobArchetype | null | undefined
): BusinessContactType {
  return "customer";
}

export function formatContactSummaryLine(contact: BusinessContact): string {
  const company = contact.companyName?.trim();
  if (company) return `${contact.displayName} / ${company}`;
  return contact.displayName;
}

export function buildContactAiContextBlock(contact: BusinessContact): string {
  const lines = [
    "Selected contact:",
    `Name: ${contact.displayName}`,
    contact.companyName ? `Company: ${contact.companyName}` : undefined,
    `Type: ${contact.contactType}`,
    contact.email ? `Email: ${contact.email}` : undefined,
    contact.phone ? `Phone: ${contact.phone}` : undefined,
    contact.address ? `Address: ${contact.address}` : undefined,
  ].filter((line): line is string => !!line && line.length > 0);
  return lines.join("\n");
}

export function buildPrimaryContactProjectPatch(
  contact: BusinessContact
): Record<string, unknown> {
  const nameSnapshot =
    contact.companyName?.trim()
      ? `${contact.displayName.trim()} (${contact.companyName.trim()})`
      : contact.displayName.trim();
  const patch: Record<string, unknown> = {
    primaryContactId: contact.id,
    primaryContactType: contact.contactType,
    primaryContactNameSnapshot: nameSnapshot,
  };
  if (contact.email?.trim()) patch.primaryContactEmailSnapshot = contact.email.trim();
  if (contact.phone?.trim()) patch.primaryContactPhoneSnapshot = contact.phone.trim();
  if (contact.address?.trim()) patch.primaryContactAddressSnapshot = contact.address.trim();
  return patch;
}

export function appendContactToProjectDetails(
  projectDetails: string | undefined,
  contact: BusinessContact | null | undefined
): string | undefined {
  if (!contact) return projectDetails;
  const block = buildContactAiContextBlock(contact);
  if (!projectDetails?.trim()) return block;
  return `${projectDetails.trim()}\n\n${block}`;
}

export async function patchPrimaryContactToProject(
  projectId: string,
  contact: BusinessContact | null | undefined
): Promise<void> {
  if (!contact?.id) return;
  try {
    await patchProjectDocument(projectId, buildPrimaryContactProjectPatch(contact));
  } catch (e) {
    if (__DEV__) {
      console.warn("[NewJobContact] primaryContact patch failed", e);
    }
    throw e;
  }
}

export function logNewJobContactDebug(payload: {
  archetype?: NewJobArchetype | null;
  hasActiveBusinessOrgId: boolean;
  hasSelectedContact: boolean;
  selectedContactType?: BusinessContactType | null;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasAddress?: boolean;
}): void {
  if (!__DEV__) return;
  console.log("[NewJobContactDebug]", payload);
}
