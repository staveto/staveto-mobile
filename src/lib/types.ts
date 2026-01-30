/**
 * Type definitions for Firestore models
 */

import { Timestamp } from 'firebase/firestore';

export type ProjectType = 'BUILD' | 'MAINTENANCE' | 'TRADE' | 'RESIDENTIAL';

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
  email?: string;
  role?: 'owner' | 'member';
  addedAt: Timestamp;
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
  assignedTrade?: string | null;
  updatedAt: Timestamp;
  doneAt: Timestamp | null;
  createdAt?: Timestamp;
  // MVP additions
  origin: 'TEMPLATE' | 'CUSTOM'; // Where task came from
  templateTaskId?: string | null; // Reference to template task if origin is TEMPLATE
  isActive?: boolean; // Soft delete flag (true = active, false = archived)
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
  taskId?: string | null; // Optional: link to task
  phaseId?: string | null; // Optional: link to phase
  attachmentId?: string | null; // Optional: invoice/receipt attachment
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
