import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { spacing } from "../theme";
import {
  NEW_JOB_ARCHETYPES,
  type NewJobArchetype,
} from "../lib/projectEnums";
import {
  getRecommendedVisibleProjectArchetypes,
  saveVisibleProjectArchetypes,
} from "../services/projectArchetypePreferences";

type Props = {
  visible: boolean;
  enabledArchetypes: NewJobArchetype[];
  onDismiss: () => void;
  onSaved: (visible: NewJobArchetype[]) => void;
};

function archetypeLabelKey(archetype: NewJobArchetype): string {
  return `createProject.archetype.${archetype}.label`;
}

export function ProjectTypeCustomizeSheet({
  visible,
  enabledArchetypes,
  onDismiss,
  onSaved,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const modalSheetHeight = useMemo(() => Math.round(Dimensions.get("window").height * 0.88), []);

  const [enabledSet, setEnabledSet] = useState<Set<NewJobArchetype>>(
    () => new Set(enabledArchetypes)
  );

  useEffect(() => {
    if (visible) {
      setEnabledSet(new Set(enabledArchetypes));
    }
  }, [visible, enabledArchetypes]);

  const handleToggle = useCallback((id: NewJobArchetype, on: boolean) => {
    setEnabledSet((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setEnabledSet(new Set(NEW_JOB_ARCHETYPES));
  }, []);

  const handleRestoreRecommended = useCallback(() => {
    setEnabledSet(new Set(getRecommendedVisibleProjectArchetypes()));
  }, []);

  const handleSave = useCallback(async () => {
    const visibleList = NEW_JOB_ARCHETYPES.filter((id) => enabledSet.has(id));
    if (visibleList.length === 0) {
      Alert.alert("", t("createProject.archetypeCustomize.minOneRequired"));
      return;
    }
    await saveVisibleProjectArchetypes(visibleList);
    onSaved(visibleList);
    onDismiss();
  }, [enabledSet, onDismiss, onSaved, t]);

  const scrollPaddingBottom = insets.bottom + spacing.xl + spacing.md;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={modalStyles.overlay}>
        <Pressable
          style={modalStyles.dismissFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("createProject.archetypeCustomize.cancel")}
        />
        <View style={[styles.sheet, { height: modalSheetHeight }]}>
          <View style={[styles.header, { paddingTop: spacing.lg }]}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t("createProject.archetypeCustomize.cancel")}
            >
              <Text style={styles.headerCancel} numberOfLines={1}>
                {t("createProject.archetypeCustomize.cancel")}
              </Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {t("createProject.archetypeCustomize.title")}
            </Text>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel={t("createProject.archetypeCustomize.save")}
            >
              <Text style={styles.headerSave} numberOfLines={1}>
                {t("createProject.archetypeCustomize.save")}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollPaddingBottom }]}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.description}>{t("createProject.archetypeCustomize.description")}</Text>

            {NEW_JOB_ARCHETYPES.map((archetype) => {
              const label = t(archetypeLabelKey(archetype));
              const on = enabledSet.has(archetype);
              return (
                <Pressable
                  key={archetype}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                  onPress={() => handleToggle(archetype, !on)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={label}
                >
                  <Text style={styles.rowLabel} numberOfLines={2}>
                    {label}
                  </Text>
                  <Switch
                    value={on}
                    onValueChange={(v) => handleToggle(archetype, v)}
                    trackColor={{ false: "rgba(255,255,255,0.3)", true: "#22c55e" }}
                    thumbColor="#fff"
                  />
                </Pressable>
              );
            })}

            <View style={styles.secondaryActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleShowAll}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.archetypeCustomize.showAll")}
              >
                <Text style={styles.secondaryBtnText}>{t("createProject.archetypeCustomize.showAll")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleRestoreRecommended}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.archetypeCustomize.restoreRecommended")}
              >
                <Text style={styles.secondaryBtnText}>
                  {t("createProject.archetypeCustomize.restoreRecommended")}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";
const SHEET_BORDER = "rgba(255,255,255,0.15)";

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  dismissFill: {
    ...StyleSheet.absoluteFillObject,
  },
});

const styles = StyleSheet.create({
  sheet: {
    width: "100%",
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: SHEET_BORDER,
  },
  headerBtn: { minWidth: 72, paddingVertical: spacing.xs },
  headerCancel: { fontSize: 16, color: SHEET_TEXT, opacity: 0.85 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: SHEET_TEXT,
    marginHorizontal: spacing.sm,
  },
  headerSave: { fontSize: 16, fontWeight: "700", color: SHEET_ACTION, textAlign: "right" },
  scrollBody: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: SHEET_TEXT,
    opacity: 0.88,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SHEET_BORDER,
    gap: spacing.md,
  },
  rowPressed: { opacity: 0.85 },
  rowLabel: { flex: 1, fontSize: 16, color: SHEET_TEXT, fontWeight: "500" },
  secondaryActions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    paddingBottom: Platform.OS === "android" ? spacing.sm : 0,
  },
  secondaryBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SHEET_BORDER,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: SHEET_ACTION,
    textAlign: "center",
  },
});
