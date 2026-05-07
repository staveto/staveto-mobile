/**
 * Range date picker for absences (vacation / sick leave / etc.).
 * Shows a month grid where the selected range from `startDate` → `endDate`
 * is visually highlighted as a continuous band.
 *
 * - First tap: sets the new start (and clears end)
 * - Second tap on/after start: sets the end
 * - Second tap before start: replaces start (range collapses to single day)
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  format,
  isToday,
} from "date-fns";
import { enUS, sk, de, cs, es, it, pl, type Locale as DateFnsLocale } from "date-fns/locale";
import { useI18n } from "../../i18n/I18nContext";
import type { Locale } from "../../i18n/translations";
import { colors, radius, spacing } from "../../theme";
import { toYmd, ymdToDate } from "../../utils/date";
import { ICON_HIT_SLOP } from "../../utils/accessibility";

const LOCALE_MAP: Record<Locale, DateFnsLocale> = {
  en: enUS,
  sk,
  de,
  cs,
  es,
  it,
  pl,
};
const WEEKDAYS_BY_LOCALE: Record<Locale, string[]> = {
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  sk: ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  cs: ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"],
  es: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"],
  it: ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const MODAL_HORIZONTAL_PADDING = spacing.md * 2;
const MODAL_INNER_PADDING = spacing.md * 2;
const DAY_CELL_SIZE = Math.max(
  36,
  Math.floor((SCREEN_WIDTH - MODAL_HORIZONTAL_PADDING - MODAL_INNER_PADDING) / 7)
);

type Props = {
  visible: boolean;
  startDate: string;
  endDate: string;
  /** Highlight color (typically the absence type color). */
  color?: string;
  onCancel: () => void;
  onConfirm: (startYmd: string, endYmd: string) => void;
};

export function AbsenceDateRangePicker({
  visible,
  startDate,
  endDate,
  color,
  onCancel,
  onConfirm,
}: Props) {
  const { t, locale } = useI18n();
  const dateFnsLocale = LOCALE_MAP[locale] ?? enUS;
  const weekdays = WEEKDAYS_BY_LOCALE[locale] ?? WEEKDAYS_BY_LOCALE.en;
  const accent = color ?? colors.primary;

  const initialMonth = useMemo(() => {
    return ymdToDate(startDate) ?? new Date();
  }, [startDate]);

  const [tempStart, setTempStart] = useState<string>(startDate);
  const [tempEnd, setTempEnd] = useState<string>(endDate);
  const [pickingEnd, setPickingEnd] = useState<boolean>(false);
  const [viewMonth, setViewMonth] = useState<Date>(initialMonth);

  // Reset internal state when modal re-opens.
  useEffect(() => {
    if (visible) {
      setTempStart(startDate);
      setTempEnd(endDate);
      setPickingEnd(false);
      setViewMonth(ymdToDate(startDate) ?? new Date());
    }
  }, [visible, startDate, endDate]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const handleDayPress = useCallback(
    (day: Date) => {
      const ymd = toYmd(day);
      if (!pickingEnd) {
        // First tap of a new range: set start, clear end (collapse to single day)
        setTempStart(ymd);
        setTempEnd(ymd);
        setPickingEnd(true);
      } else {
        if (ymd < tempStart) {
          // User tapped before current start → start a new selection from this day
          setTempStart(ymd);
          setTempEnd(ymd);
          // Stay in pickingEnd so the next tap finalizes the end
        } else {
          setTempEnd(ymd);
          setPickingEnd(false);
        }
      }
    },
    [pickingEnd, tempStart]
  );

  const handleConfirm = useCallback(() => {
    let s = tempStart;
    let e = tempEnd;
    if (e < s) [s, e] = [e, s];
    onConfirm(s, e);
  }, [tempStart, tempEnd, onConfirm]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel} accessibilityRole="button">
        <Pressable
          style={styles.modal}
          onPress={(ev) => ev.stopPropagation()}
          accessibilityViewIsModal
        >
          <View style={[styles.header, { backgroundColor: accent }]}>
            <Text style={styles.headerHint}>
              {pickingEnd ? t("absence.endDate") : t("absence.startDate")}
            </Text>
            <Text style={styles.headerRange} numberOfLines={1}>
              {tempStart === tempEnd ? tempStart : `${tempStart} → ${tempEnd}`}
            </Text>
          </View>

          <View style={styles.calendarWrap}>
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={() => setViewMonth((m) => subMonths(m, 1))}
                style={styles.navBtn}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {format(viewMonth, "LLLL yyyy", { locale: dateFnsLocale })}
              </Text>
              <TouchableOpacity
                onPress={() => setViewMonth((m) => addMonths(m, 1))}
                style={styles.navBtn}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-forward" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {weekdays.map((d) => (
                <Text key={d} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {days.map((day) => {
                const ymd = toYmd(day);
                const inMonth = isSameMonth(day, viewMonth);
                const isStart = ymd === tempStart;
                const isEnd = ymd === tempEnd;
                const inRange = ymd > tempStart && ymd < tempEnd;
                const isEndpoint = isStart || isEnd;
                const isSingle = tempStart === tempEnd && isStart;
                const today = isToday(day);

                return (
                  <View key={ymd} style={styles.cellWrap}>
                    {/* Range band — drawn behind the circle, extends to cell edges. */}
                    {(inRange || (isEndpoint && !isSingle)) && (
                      <View
                        style={[
                          styles.rangeBand,
                          { backgroundColor: hexWithAlpha(accent, 0.18) },
                          isStart && !isSingle && styles.rangeBandStart,
                          isEnd && !isSingle && styles.rangeBandEnd,
                        ]}
                      />
                    )}
                    <TouchableOpacity
                      onPress={() => handleDayPress(day)}
                      activeOpacity={0.7}
                      style={[
                        styles.dayCell,
                        isEndpoint && { backgroundColor: accent },
                        today && !isEndpoint && styles.dayCellToday,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={ymd}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          !inMonth && styles.dayTextDisabled,
                          isEndpoint && styles.dayTextEndpoint,
                          today && !isEndpoint && { color: accent, fontWeight: "700" },
                        ]}
                      >
                        {format(day, "d")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.actionBtn} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleConfirm}
              style={styles.actionBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={[styles.actionText, { color: accent, fontWeight: "700" }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** "#a855f7" + alpha 0.18 → "#a855f72e" (8-digit hex). */
function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  // Tolerate already-rgba colors / 8-digit hex by passing them through.
  if (hex.length === 7 && hex.startsWith("#")) return `${hex}${a}`;
  return hex;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  modal: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: radius,
    overflow: "hidden",
  },
  header: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  headerHint: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "600",
  },
  headerRange: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  calendarWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  navBtn: {
    padding: spacing.xs,
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cellWrap: {
    width: DAY_CELL_SIZE,
    height: DAY_CELL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  rangeBand: {
    position: "absolute",
    top: (DAY_CELL_SIZE - 32) / 2,
    bottom: (DAY_CELL_SIZE - 32) / 2,
    left: 0,
    right: 0,
  },
  rangeBandStart: { left: "50%" },
  rangeBandEnd: { right: "50%" },
  dayCell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  dayText: {
    fontSize: 14,
    color: colors.text,
  },
  dayTextDisabled: {
    color: "rgba(0,0,0,0.3)",
  },
  dayTextEndpoint: {
    color: "#fff",
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.formPanelBorder,
    gap: spacing.sm,
  },
  actionBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
