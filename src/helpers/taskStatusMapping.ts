/**
 * Task Status Mapping Helper
 * 
 * Single source of truth for mapping stored task status values to UI labels.
 * This ensures clearer labels for tradesmen without changing database structure.
 * 
 * DB SAFETY: No database schema changes - only UI presentation layer mapping.
 */

export type StoredStatusValue = "OPEN" | "DOING" | "DONE" | "Otvorený" | "Začatý" | "Hotový";

export interface StatusMapping {
  /** The value stored in the database (unchanged) */
  storedValue: StoredStatusValue;
  /** The label displayed in the UI */
  uiLabel: string;
  /** Optional caption/subtitle for additional context */
  caption?: string;
  /** Optional icon name for visual indication */
  icon?: string;
}

/**
 * Complete mapping of all supported status values to their UI labels.
 * Handles both English ("OPEN", "DOING", "DONE") and Slovak ("Otvorený", "Začatý", "Hotový") stored values.
 */
const STATUS_MAPPINGS: StatusMapping[] = [
  {
    storedValue: "OPEN",
    uiLabel: "Otvorený",
    caption: "Čaká",
  },
  {
    storedValue: "DOING",
    uiLabel: "V práci",
  },
  {
    storedValue: "DONE",
    uiLabel: "Hotovo",
  },
  // Also support Slovak stored values (if they exist in DB)
  {
    storedValue: "Otvorený",
    uiLabel: "Otvorený",
    caption: "Čaká",
  },
  {
    storedValue: "Začatý",
    uiLabel: "V práci",
  },
  {
    storedValue: "Hotový",
    uiLabel: "Hotovo",
  },
];

/**
 * Get UI label for a stored status value.
 * Returns the mapped UI label, or falls back to the raw value if unknown.
 * 
 * @param storedValue - The status value from the database
 * @returns The UI label to display
 */
export function getStatusLabel(storedValue: string | null | undefined): string {
  if (!storedValue) {
    return "Otvorený"; // Default fallback
  }

  const normalized = storedValue.trim();
  const mapping = STATUS_MAPPINGS.find(m => 
    m.storedValue === normalized || 
    m.storedValue.toUpperCase() === normalized.toUpperCase()
  );

  if (mapping) {
    return mapping.uiLabel;
  }

  // Defensive fallback: log warning in dev, return raw value
  if (__DEV__) {
    console.warn(
      `[taskStatusMapping] Unknown status value encountered: "${storedValue}". ` +
      `Displaying raw value. Please check database or add mapping.`
    );
  }

  return normalized;
}

/**
 * Get full status mapping (including caption) for a stored status value.
 * 
 * @param storedValue - The status value from the database
 * @returns The complete mapping, or null if not found
 */
export function getStatusMapping(storedValue: string | null | undefined): StatusMapping | null {
  if (!storedValue) {
    return STATUS_MAPPINGS.find(m => m.storedValue === "OPEN") || null;
  }

  const normalized = storedValue.trim();
  const mapping = STATUS_MAPPINGS.find(m => 
    m.storedValue === normalized || 
    m.storedValue.toUpperCase() === normalized.toUpperCase()
  );

  if (!mapping && __DEV__) {
    console.warn(
      `[taskStatusMapping] Unknown status value: "${storedValue}". ` +
      `Using fallback mapping.`
    );
  }

  return mapping || null;
}

/**
 * Get all available status mappings for rendering UI controls (e.g., segmented control).
 * Returns only the primary mappings (English stored values) to avoid duplicates.
 * 
 * @returns Array of status mappings for UI rendering
 */
export function getStatusMappingsForUI(): StatusMapping[] {
  // Return only English stored values to avoid duplicates
  return STATUS_MAPPINGS.filter(m => 
    m.storedValue === "OPEN" || 
    m.storedValue === "DOING" || 
    m.storedValue === "DONE"
  );
}

/**
 * Normalize a status value to the canonical stored value.
 * This ensures we always save the correct value regardless of case or format.
 * 
 * @param value - The status value to normalize
 * @returns The canonical stored value (English uppercase)
 */
export function normalizeStatusValue(value: string | null | undefined): StoredStatusValue {
  if (!value) {
    return "OPEN"; // Default
  }

  const normalized = value.trim().toUpperCase();

  // Map Slovak values to English stored values
  if (normalized === "OTVORENÝ" || normalized === "OTVORENY") {
    return "OPEN";
  }
  if (normalized === "ZAČATÝ" || normalized === "ZACATY" || normalized === "DOING") {
    return "DOING";
  }
  if (normalized === "HOTOVÝ" || normalized === "HOTOVY" || normalized === "DONE") {
    return "DONE";
  }

  // If already in English format, return as-is
  if (normalized === "OPEN" || normalized === "DOING" || normalized === "DONE") {
    return normalized as StoredStatusValue;
  }

  // Fallback: return OPEN for unknown values
  if (__DEV__) {
    console.warn(
      `[taskStatusMapping] Could not normalize status value: "${value}". ` +
      `Defaulting to "OPEN".`
    );
  }

  return "OPEN";
}
