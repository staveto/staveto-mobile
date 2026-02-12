/**
 * Compute next due date from base date + interval.
 * Used for MAINTENANCE v2 service rules.
 * DST-safe: result time set to 09:00 local (Europe/Zurich) to avoid midnight DST issues.
 */

import { addWeeks, addMonths, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;

/**
 * Set date to 09:00 local time (Europe/Zurich) to avoid midnight DST issues.
 */
function toNineAmLocal(d: Date): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(d, DEFAULT_HOUR), DEFAULT_MINUTE), 0), 0);
}

/**
 * Compute next due date from base date + interval.
 * - weeks: add intervalValue * 7 days
 * - months: calendar add months (NOT 30*days)
 */
export function computeNextDueAt(
  baseDate: Date,
  intervalUnit: 'weeks' | 'months',
  intervalValue: number
): Date {
  let next: Date;
  if (intervalUnit === 'weeks') {
    next = addWeeks(baseDate, intervalValue);
  } else {
    // months: calendar add
    next = addMonths(baseDate, intervalValue);
  }
  return toNineAmLocal(next);
}
