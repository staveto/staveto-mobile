import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import { toYmd, ymdToDate } from "../../utils/date";
import * as absencesService from "../../services/absences";
import type { AbsenceType } from "../../services/absences";
import { ABSENCE_COLOR, ABSENCE_TYPE_KEYS, ABSENCE_TYPES_ORDER } from "./absenceUi";

type RouteParams = { ymd?: string };

export function AbsenceRequestScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { ymd: presetYmd } = (route.params as RouteParams) ?? {};
  const { user, orgId } = useAuth();
  const { t } = useI18n();

  const initialYmd = presetYmd && /^\d{4}-\d{2}-\d{2}$/.test(presetYmd) ? presetYmd : toYmd(new Date());
  const [type, setType] = useState<AbsenceType>("vacation");
  const [startDate, setStartDate] = useState<string>(initialYmd);
  const [endDate, setEndDate] = useState<string>(initialYmd);
  const [note, setNote] = useState("");
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const isOwner = !!user?.id && !!orgId && absencesService.isSoloOwner(user.id, orgId);
  const userName = useMemo(() => {
    if (user?.name) return user.name;
    if (user?.firstName || user?.lastName) return `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
    return user?.email ?? "";
  }, [user]);

  const onChangeStart = (_ev: any, picked?: Date) => {
    setShowStartPicker(Platform.OS === "ios");
    if (!picked) return;
    const ymd = toYmd(picked);
    setStartDate(ymd);
    if (endDate < ymd) setEndDate(ymd);
  };
  const onChangeEnd = (_ev: any, picked?: Date) => {
    setShowEndPicker(Platform.OS === "ios");
    if (!picked) return;
    const ymd = toYmd(picked);
    if (ymd < startDate) {
      Alert.alert(t("common.error"), t("absence.invalidRange"));
      return;
    }
    setEndDate(ymd);
  };

  const submit = useCallback(async () => {
    if (!user?.id || !orgId) return;
    if (endDate < startDate) {
      Alert.alert(t("common.error"), t("absence.invalidRange"));
      return;
    }
    setSaving(true);
    try {
      await absencesService.requestAbsence({
        orgId,
        userId: user.id,
        userNameSnapshot: userName,
        type,
        startDate,
        endDate,
        note: note.trim() || undefined,
        isOwnerOrManager: isOwner,
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  }, [user?.id, orgId, userName, type, startDate, endDate, note, isOwner, navigation, t]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>{t("absence.type")}</Text>
        <View style={styles.typeRow}>
          {ABSENCE_TYPES_ORDER.map((tp) => {
            const active = tp === type;
            const color = ABSENCE_COLOR[tp];
            return (
              <TouchableOpacity
                key={tp}
                onPress={() => setType(tp)}
                activeOpacity={0.85}
                style={[styles.typeChip, active && { backgroundColor: color, borderColor: color }]}
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
          ymd={startDate}
          onPress={() => setShowStartPicker(true)}
        />
        <View style={styles.divider} />
        <DateRow
          label={t("absence.endDate")}
          ymd={endDate}
          onPress={() => setShowEndPicker(true)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t("absence.note")}</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t("absence.notePlaceholder")}
          placeholderTextColor={colors.inputPlaceholderOnLight}
          multiline
          style={styles.noteInput}
        />
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={submit}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{t("absence.save")}</Text>}
      </TouchableOpacity>

      {showStartPicker && DateTimePicker && (
        <DateTimePicker
          value={ymdToDate(startDate) ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={onChangeStart}
        />
      )}
      {showEndPicker && DateTimePicker && (
        <DateTimePicker
          value={ymdToDate(endDate) ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          minimumDate={ymdToDate(startDate) ?? undefined}
          onChange={onChangeEnd}
        />
      )}
    </ScrollView>
  );
}

function DateRow({ label, ymd, onPress }: { label: string; ymd: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.dateRow} activeOpacity={0.7}>
      <Ionicons name="calendar-outline" size={20} color={colors.text} />
      <View style={styles.dateRowBody}>
        <Text style={styles.dateRowLabel}>{label}</Text>
        <Text style={styles.dateRowValue}>{ymd}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
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
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
