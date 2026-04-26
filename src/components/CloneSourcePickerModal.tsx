/**
 * Modal that lets the user pick an existing project to clone from inside the
 * create-project wizard (CLONE creation mode). Filters by engine type so a TRADE
 * user only sees TRADE jobs and a BUILD user only sees BUILD projects. Hands the
 * picked project off to `CloneProjectModal` via `onPick`.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Switch,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { ProjectDoc } from "../services/projects";
import {
  getActiveProductProjectType,
  isLegacyMaintenanceEquipmentHub,
  isKnownStorageType,
} from "../lib/projectTypeModel";

type Props = {
  visible: boolean;
  /** TRADE shows only TRADE jobs; BUILD shows only BUILD projects. */
  engineType: "BUILD" | "TRADE";
  /** Already loaded projects from `ProjectsScreen` — avoids a second network read. */
  projects: ProjectDoc[];
  onClose: () => void;
  onPick: (project: ProjectDoc) => void;
};

export function CloneSourcePickerModal({ visible, engineType, projects, onClose, onPick }: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [templatesOnly, setTemplatesOnly] = useState(false);

  const eligible = useMemo(() => {
    return projects.filter((p) => {
      if (!p.projectType || !isKnownStorageType(p.projectType)) return false;
      if (isLegacyMaintenanceEquipmentHub(p)) return false;
      if (getActiveProductProjectType(p) !== engineType) return false;
      if (templatesOnly && !p.isTemplate) return false;
      const q = search.trim().toLowerCase();
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, engineType, templatesOnly, search]);

  const titleKey = engineType === "BUILD" ? "cloneSourcePicker.title.BUILD" : "cloneSourcePicker.title.TRADE";
  const emptyKey = engineType === "BUILD" ? "cloneSourcePicker.empty.BUILD" : "cloneSourcePicker.empty.TRADE";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t(titleKey)}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t("cloneSourcePicker.cancel")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>{t("cloneSourcePicker.subtitle")}</Text>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t("cloneSourcePicker.search")}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{t("cloneSourcePicker.templatesOnly")}</Text>
            <Switch
              value={templatesOnly}
              onValueChange={setTemplatesOnly}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          {eligible.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t(emptyKey)}</Text>
            </View>
          ) : (
            <FlatList
              data={eligible}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const icon = engineType === "TRADE" ? "briefcase-outline" : "clipboard-outline";
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => onPick(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons name={icon} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name || t("projects.noName")}
                      </Text>
                      {item.city || item.addressText ? (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {(item.city?.trim() || item.addressText?.trim() || "").split(",")[0]}
                        </Text>
                      ) : null}
                    </View>
                    {item.isTemplate ? (
                      <View style={styles.templateBadge}>
                        <Text style={styles.templateBadgeText}>{t("cloneSourcePicker.templateBadge")}</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: "85%",
    minHeight: 360,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    paddingRight: spacing.md,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  toggleLabel: {
    fontSize: 14,
    color: colors.text,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary + "1A",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  templateBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.primary + "20",
    borderWidth: 1,
    borderColor: colors.primary + "40",
  },
  templateBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
});
