/**
 * Type definitions for Firestore models
 */

import type { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";

type Timestamp = FirebaseFirestoreTypes.Timestamp;

export type ProjectType = 'BUILD' | 'MAINTENANCE' | 'TRADE' | 'RESIDENTIAL' | 'MANAGEMENT';

export type TaskStatus = 'OPEN' | 'DONE' | 'IN_PROGRESS' | 'BLOCKED';

export interface CatalogTemplate {
  id: string;
  name: string;
  description?: string;
  projectType: ProjectType;
  version: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CatalogPhase {
  id: string;
  name: string;
  order: number;
  description?: string;
}

export interface CatalogTask {
  id: string;
  phaseId: string;
  title: string;
  description?: string;
  order: number;
  required: boolean;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  projectType: ProjectType;
  templateId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectMember {
  id: string;
  userId: string;
  emailLower: string;
  displayName?: string;
  role: "MEMBER";
  joinedAt: Timestamp;
  addedBy: string;
}

export interface Contractor {
  id: string;
  displayName: string;
  phoneE164: string;
  phoneRaw?: string;
  email?: string;
  note?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ProjectSupplier {
  id: string;
  contractorId: string;
  phoneE164: string;
  displayNameSnapshot: string;
  status: "active" | "inactive";
  createdAt?: Timestamp;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  supplierId?: string | null;
  status: "pending" | "approved" | "ignored";
  messageText?: string | null;
  fromPhoneE164?: string | null;
  sourceMessageId?: string | null;
  media?: {
    storagePath: string;
    mimeType?: string;
    size?: number;
    fileName?: string;
  }[];
  createdAt?: Timestamp;
  decidedBy?: string | null;
  decidedAt?: Timestamp | null;
}

export interface ProjectPhase {
  id: string;
  projectId: string; // Required: reference to parent project
  ownerId: string; // Required: same as project owner
  name: string;
  order: number;
  status?: string;
}

export interface ProjectTask {
  id: string;
  projectId: string; // Required: reference to parent project
  ownerId: string; // Required: same as project owner
  phaseId: string;
  title: string;
  description?: string;
  order: number;
  status: TaskStatus;
  required: boolean;
  assigneeId: string | null; // User ID who is assigned (consistent naming)
  assigneeName?: string | null; // Optional: display name for assignee
  assignedTo?: string | null;
  assignedToEmail?: string | null;
  assignedTrade?: string | null;
  updatedAt: Timestamp;
  doneAt: Timestamp | null;
  createdAt?: Timestamp;
  // MVP additions
  origin: 'TEMPLATE' | 'CUSTOM'; // Where task came from
  templateTaskId?: string | null; // Reference to template task if origin is TEMPLATE
  isActive?: boolean; // Soft delete flag (true = active, false = archived)
  // MAINTENANCE v2: service task fields
  equipmentId?: string | null;
  serviceRuleId?: string | null;
  checklist?: Array<{ id: string; title: string; done: boolean }>;
  /** Standard subtasks (preferred over checklist). Used for all project types. */
  subtasks?: Array<{ id: string; title: string; done: boolean; order: number }>;
  timeSpentMinutes?: number | null;
}

export interface PhaseStats {
  phaseId: string;
  totalTasks: number;
  openTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  completionPercentage: number;
}

export interface ProjectStats {
  totalTasks: number;
  openTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  completionPercentage: number;
}

export interface ProjectExpense {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  amount: number;
  currency: string; // e.g., "EUR", "CZK"
  date: Timestamp; // Date of expense
  note?: string;
  supplierIco?: string | null; // Optional: supplier ICO
  taskId?: string | null; // Optional: link to task
  phaseId?: string | null; // Optional: link to phase
  attachmentId?: string | null; // Optional: invoice/receipt attachment
  uploadStatus?: "pending" | "uploaded" | "failed";
  filePath?: string | null;
  mimeType?: string | null;
  ocrStatus?: "success" | "done" | "failed" | "limit" | "cancelled" | "pending";
  ocrParsedAt?: Timestamp | null;
  ocrSupplierName?: string | null;
  ocrInvoiceNumber?: string | null;
  ocrIssueDate?: string | null;
  ocrTotalAmount?: number | null;
  ocrVatAmount?: number | null;
  ocrCurrency?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConstructionDiaryEntry {
  id: string;
  projectId: string;
  ownerId: string;
  date: Timestamp; // Date of diary entry
  weather?: string; // Weather conditions
  workers?: string; // Number/names of workers
  workDescription: string; // Description of work done
  materials?: string; // Materials used
  notes?: string; // Additional notes
  phaseId?: string | null; // Optional: link to phase
  attachments?: string[]; // Array of attachment IDs
  createdBy: string; // User ID who created the entry
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  ownerId: string;
  name: string; // Document name/title
  type: 'plan' | 'permit' | 'contract' | 'report' | 'other'; // Document type
  description?: string;
  attachmentId: string; // Reference to attachment in Storage
  phaseId?: string | null; // Optional: link to phase
  uploadedBy: string; // User ID who uploaded
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ProjectEventType =
  | "photo_added"
  | "document_added"
  | "expense_added"
  | "ocr_completed"
  | "task_created"
  | "task_done"
  | "member_invited"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "diary_added";

export interface ProjectEvent {
  id: string;
  type: ProjectEventType;
  createdAt: unknown;
  actorId: string;
  actorName?: string | null;
  payload?: {
    actorName?: string;
    projectName?: string;
    taskTitle?: string;
    fileName?: string;
    amount?: number;
    currency?: string;
    supplier?: string;
    count?: number;
    email?: string;
    targetUserId?: string;
    targetEmail?: string;
    targetName?: string;
    text?: string;
  };
  ref?: {
    kind?: string;
    id?: string;
    [key: string]: unknown;
  } | null;
}
