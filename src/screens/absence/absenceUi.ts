import type { AbsenceStatus, AbsenceType } from "../../services/absences";

export const ABSENCE_COLOR: Record<AbsenceType, string> = {
  vacation: "#a855f7",
  sick: "#0ea5e9",
  doctor: "#22c55e",
  unpaid: "#f97316",
  personal: "#ec4899",
};

export const ABSENCE_TYPE_KEYS: Record<AbsenceType, string> = {
  vacation: "absence.type.vacation",
  sick: "absence.type.sick",
  doctor: "absence.type.doctor",
  unpaid: "absence.type.unpaid",
  personal: "absence.type.personal",
};

export const ABSENCE_STATUS_KEYS: Record<AbsenceStatus, string> = {
  pending: "absence.status.pending",
  approved: "absence.status.approved",
  rejected: "absence.status.rejected",
  cancelled: "absence.status.cancelled",
};

export const ABSENCE_TYPES_ORDER: AbsenceType[] = [
  "vacation",
  "sick",
  "doctor",
  "personal",
  "unpaid",
];

export type AbsenceCalendarCell = {
  type: AbsenceType;
  status: AbsenceStatus;
  isStart: boolean;
  isEnd: boolean;
  halfDayStart?: "AM" | "PM" | null;
  halfDayEnd?: "AM" | "PM" | null;
};
