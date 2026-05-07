import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import { toYmd, ymdToDate } from "../../utils/date";
import { doc, getDoc } from "../../lib/rnFirestore";
import { db } from "../../firebase";
import { paths } from "../../lib/firestorePaths";
import * as absencesService from "../../services/absences";
import type { AbsenceDoc, AbsenceHalfDay, AbsenceType } from "../../services/absences";
import { ABSENCE_COLOR, ABSENCE_STATUS_KEYS, ABSENCE_TYPE_KEYS, ABSENCE_TYPES_ORDER } from "./absenceUi";

let DateTimePicker: any = null;
try {
  DateTimePicker = require("@react-native-community/datetimepicker").default;
} catch {
  // optional dep
}

type RouteParams = { absenceId: string };

export function AbsenceDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { absenceId } = (route.params as RouteParams) ?? { absenceId: "" };
  const { user, orgId } = useAuth();
  const { t } = useI18n();

  const [absence, setAbsence] = useState<AbsenceDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const isOwner = !!user?.id && !!orgId && absencesService.isSoloOwner(user.id, orgId);

  const load = useCallback(async () => {
    if (!absenceId) {
      setLoading(false);
      return;
    }
    try {
      const snap = await getDoc(doc(db, paths.absence(absenceId)));
      if (!snap.exists()) {
        setAbsence(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      // Reuse the same shape produced by snapshotToDoc — duplicate minimal mapping inline
      const a: AbsenceDoc = {
        id: snap.id,
        orgId: (data.orgId as string) ?? "",
        userId: (data.userId as string) ?? "",
        userNameSnapshot: (data.userNameSnapshot as string) ?? "",
        type: (data.type as AbsenceType) ?? "vacation",
        status: (data.status as AbsenceDoc["status"]) ?? "pending",
        startDate: (data.startDate as string) ?? "",
        endDate: (data.endDate as string) ?? "",
        halfDayStart: (data.halfDayStart as AbsenceHalfDay | null | undefined) ?? null,
        halfDayEnd: (data.halfDayEnd as AbsenceHalfDay | null | undefined) ?? null,
        hoursPerDay: typeof data.hoursPerDay === "number" ? (data.hoursPerDay as number) : undefined,
        note: typeof data.note === "string" ? (data.note as string) : undefined,
        attachments: undefined,
        requestedBy: (data.requestedBy as string) ?? "",
        requestedAt: "",
        approvedBy: (data.approvedBy as string | null | undefined) ?? null,
        approvedAt: null,
        rejectedReason: (data.rejectedReason as string | null | undefined) ?? null,
        createdAt: "",
        updatedAt: "",
      };
      setAbsence(a);
    } catch (e) {
      if (__DEV__) console.warn("[AbsenceDetailScreen] load failed:", e);
      setAbsence(null);
    } finally {
      setLoading(false);
    }
  }, [absenceId]);

  useEffect(() => {
    load();
  }, [load]);

  const readOnly =
    !absence || absence.status === "rejected" || absence.status === "cancelled" || (!!user?.id && absence.userId !== user.id);

  const persistDates = useCallback(
    async (next: { startDate?: string; endDate?: string }) => {
      if (!absence) return;
      const startDate = next.startDate ?? absence.startDate;
      const endDate = next.endDate ?? absence.endDate;
      if (endDate < startDate) {
        Alert.alert(t("common.error"), t("absence.invalidRange"));
        return;
      }
      setSaving(true);
      try {
        const result = await absencesService.updateAbsenceDates(absence.id, {
          startDate,
          endDate,
          isOwnerOrManager: isOwner,
        });
        setAbsence((prev) =>
          prev
            ? {
                ...prev,
                startDate,
                endDate,
                status: result.reverted ? "pending" : prev.status,
                approvedBy: result.reverted ? null : prev.approvedBy,
                approvedAt: result.reverted ? null : prev.approvedAt,
              }
            : prev
        );
        if (result.reverted) {
          Alert.alert(t("absence.title"), t("absence.dateChangedPending"));
        }
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message ?? "");
      } finally {
        setSaving(false);
      }
    },
    [absence, isOwner, t]
  );

  const persistType = useCallback(
    async (nextType: AbsenceType) => {
      if (!absence || readOnly) return;
      setSaving(true);
      try {
        await absencesService.updateAbsenceDetails(absence.id, { type: nextType });
        setAbsence((prev) => (prev ? { ...prev, type: nextType } : prev));
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message ?? "");
      } finally {
        setSaving(false);
      }
    },
    [absence, readOnly, t]
  );

  const persistNote = useCallback(
    async (nextNote: string) => {
      if (!absence || readOnly) return;
      setSaving(true);
      try {
        await absencesService.updateAbsenceDetails(absence.id, { note: nextNote });
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message ?? "");
      } finally {
        setSaving(false);
      }
    },
    [absence, readOnly, t]
  );

  const onCancel = useCallback(() => {
    if (!absence) return;
    Alert.alert(t("absence.cancelConfirmTitle"), t("absence.cancelConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("absence.cancel"),
        style: "destructive",
        onPress: async () => {
          try {
            await absencesService.cancelAbsence(absence.id);
            navigation.goBack();
          } catch (e: any) {
            Alert.alert(t("common.error"), e?.message ?? "");
          }
        },
      },
    ]);
  }, [absence, navigation, t]);

  const onChangeStart = (_ev: any, picked?: Date) => {
    setShowStartPicker(Platform.OS === "ios");
    if (!picked) return;
    persistDates({ startDate: toYmd(picked) });
  };
  const onChangeEnd = (_ev: any, picked?: Date) => {
    setShowEndPicker(Platform.OS === "ios");
    if (!picked) return;
    persistDates({ endDate: toYmd(picked) });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!absence) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t("absence.empty")}</Text>
      </View>
    );
  }

  const colorBar = ABSENCE_COLOR[absence.type];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.header, { borderColor: colorBar }]}>
        <View style={[styles.headerDot, { backgroundColor: colorBar }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerType}>{t(ABSENCE_TYPE_KEYS[absence.type])}</Text>
          <Text style={styles.headerStatus}>{t(ABSENCE_STATUS_KEYS[absence.status])}</Text>
        </View>
        {saving ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {readOnly ? (
        <View style={styles.readOnlyCard}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
          <Text style={styles.readOnlyText}>{t("absence.readOnly")}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>{t("absence.type")}</Text>
        <View style={styles.typeRow}>
          {ABSENCE_TYPES_ORDER.map((tp) => {
            const active = tp === absence.type;
            const color = ABSENCE_COLOR[tp];
            return (
              <TouchableOpacity
                key={tp}
                disabled={readOnly}
                onPress={() => persistType(tp)}
                activeOpacity={0.85}
                style={[styles.typeChip, active && { backgroundColor: color, borderColor: color }, readOnly && styles.disabledChip]}
              >
                <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t(ABSENCE_TYPE_KEYS[tp])}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <DateRow
          label={t("absence.startDate")}
          ymd={absence.startDate}
          onPress={() => !readOnly && setShowStartPicker(true)}
          disabled={readOnly}
        />
        <View style={styles.divider} />
        <DateRow
          label={t("absence.endDate")}
          ymd={absence.endDate}
          onPress={() => !readOnly && setShowEndPicker(true)}
          disabled={readOnly}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t("absence.note")}</Text>
        <NoteEditor
          initial={absence.note ?? ""}
          placeholder={t("absence.notePlaceholder")}
          disabled={readOnly}
          onSubmit={persistNote}
        />
      </View>

      {!readOnly && (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
          <Ionicons name="close-circle-outline" size={20} color={colors.error} />
          <Text style={styles.cancelBtnText}>{t("absence.cancel")}</Text>
        </TouchableOpacity>
      )}

      {showStartPicker && DateTimePicker && (
        <DateTimePicker
          value={ymdToDate(absence.startDate) ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={onChangeStart}
        />
      )}
      {showEndPicker && DateTimePicker && (
        <DateTimePicker
          value={ymdToDate(absence.endDate) ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          minimumDate={ymdToDate(absence.startDate) ?? undefined}
          onChange={onChangeEnd}
        />
      )}
    </ScrollView>
  );
}

function DateRow({ label, ymd, onPress, disabled }: { label: string; ymd: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.dateRow} activeOpacity={disabled ? 1 : 0.7}>
      <Ionicons name="calendar-outline" size={20} color={disabled ? colors.textMuted : colors.text} />
      <View style={styles.dateRowBody}>
        <Text style={styles.dateRowLabel}>{label}</Text>
        <Text style={[styles.dateRowValue, disabled && { color: colors.textMuted }]}>{ymd}</Text>
      </View>
      {!disabled ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </TouchableOpacity>
  );
}

function NoteEditor({
  initial,
  placeholder,
  disabled,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  disabled?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(initial);
  }, [initial]);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={colors.inputPlaceholderOnLight}
      multiline
      editable={!disabled}
      style={[styles.noteInput, disabled && { opacity: 0.7 }]}
      onBlur={() => {
        if (text.trim() !== initial.trim()) onSubmit(text);
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.formPanel,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    gap: spacing.md,
  },
  headerDot: { width: 14, height: 14, borderRadius: 7 },
  headerType: { fontSize: 18, fontWeight: "800", color: colors.text },
  headerStatus: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  readOnlyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: radius,
    padding: spacing.md,
  },
  readOnlyText: { color: colors.labelMutedOnDark, flex: 1, fontSize: 13 },
  card: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.md,
  },
  label: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  typeChipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  typeChipTextActive: { color: "#fff" },
  disabledChip: { opacity: 0.6 },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  dateRowBody: { flex: 1 },
  dateRowLabel: { fontSize: 12, color: colors.textMuted },
  dateRowValue: { fontSize: 16, fontWeight: "600", color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, opacity: 0.25 },
  noteInput: {
    minHeight: 80,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: "#fff",
    color: colors.text,
    textAlignVertical: "top",
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(220,53,69,0.4)",
    backgroundColor: "rgba(220,53,69,0.08)",
  },
  cancelBtnText: { color: colors.error, fontWeight: "700", fontSize: 15 },
  emptyTitle: { fontSize: 16, color: colors.textOnDark },
});
