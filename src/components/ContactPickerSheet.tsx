import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import {
  listBusinessContacts,
  createBusinessContact,
  getBusinessContact,
  BUSINESS_CONTACT_TYPES,
  type BusinessContact,
  type BusinessContactType,
} from "../services/businessContacts";
import { defaultContactTypeForArchetype } from "../lib/newJobContact";
import type { NewJobArchetype } from "../lib/projectEnums";

type FilterKey = "all" | BusinessContactType;

type Props = {
  visible: boolean;
  orgId: string | null;
  jobArchetype: NewJobArchetype | null;
  initialMode?: "list" | "create";
  onDismiss: () => void;
  onSelect: (contact: BusinessContact) => void;
};

function contactTypeLabelKey(type: BusinessContactType): string {
  return `business.contacts.type.${type}`;
}

export function ContactPickerSheet({
  visible,
  orgId,
  jobArchetype,
  initialMode = "list",
  onDismiss,
  onSelect,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [mode, setMode] = useState<"list" | "create">("list");
  const [creating, setCreating] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");

  const defaultType = defaultContactTypeForArchetype(jobArchetype);

  const loadContacts = useCallback(async () => {
    if (!orgId?.trim()) {
      setContacts([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listBusinessContacts(orgId, { includeArchived: false });
      setContacts(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      setError(msg || t("business.contacts.loadError"));
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, t]);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setSearch("");
    setFilter("all");
    setNewDisplayName("");
    setNewCompanyName("");
    setNewEmail("");
    setNewPhone("");
    setNewAddress("");
    void loadContacts();
  }, [visible, initialMode, loadContacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filter !== "all" && c.contactType !== filter) return false;
      if (!q) return true;
      const blob = [c.displayName, c.companyName, c.email, c.phone, c.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [contacts, filter, search]);

  const handleQuickCreate = async () => {
    const displayName = newDisplayName.trim();
    if (!displayName) {
      Alert.alert("", t("business.contacts.displayNameRequired"));
      return;
    }
    if (!orgId?.trim()) return;
    setCreating(true);
    try {
      const id = await createBusinessContact(orgId, {
        displayName,
        companyName: newCompanyName.trim() || undefined,
        contactType: defaultType,
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
        address: newAddress.trim() || undefined,
      });
      const created = await getBusinessContact(orgId, id);
      if (created) {
        onSelect(created);
        onDismiss();
        return;
      }
      await loadContacts();
      setMode("list");
      Alert.alert("", t("business.contacts.createdSelectFromList"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert(t("common.error"), msg || t("business.contacts.createError"));
    } finally {
      setCreating(false);
    }
  };

  const filterOptions: { key: FilterKey; label: string }[] = useMemo(
    () => [
      { key: "all", label: t("business.contacts.filter.all") },
      ...BUSINESS_CONTACT_TYPES.map((type) => ({
        key: type as FilterKey,
        label: t(contactTypeLabelKey(type)),
      })),
    ],
    [t]
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {mode === "create" ? t("createProject.newJob.contact.createTitle") : t("createProject.newJob.contact.pickerTitle")}
          </Text>
          <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {!orgId ? (
          <View style={styles.centerBox}>
            <Text style={styles.muted}>{t("createProject.newJob.contact.noOrgHint")}</Text>
          </View>
        ) : mode === "create" ? (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>{t("business.contacts.displayName")} *</Text>
            <TextInput
              style={styles.input}
              value={newDisplayName}
              onChangeText={setNewDisplayName}
              placeholder={t("business.contacts.displayNamePlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>{t("business.contacts.companyName")}</Text>
            <TextInput
              style={styles.input}
              value={newCompanyName}
              onChangeText={setNewCompanyName}
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>{t("business.contacts.email")}</Text>
            <TextInput
              style={styles.input}
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>{t("business.contacts.phone")}</Text>
            <TextInput
              style={styles.input}
              value={newPhone}
              onChangeText={setNewPhone}
              keyboardType="phone-pad"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>{t("business.contacts.address")}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={newAddress}
              onChangeText={setNewAddress}
              multiline
              textAlignVertical="top"
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity
              style={[styles.btnPrimary, creating && styles.btnDisabled]}
              onPress={() => void handleQuickCreate()}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{t("createProject.newJob.contact.createAndSelect")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGhost} onPress={() => setMode("list")} disabled={creating}>
              <Text style={styles.btnGhostText}>{t("common.back")}</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder={t("business.contacts.searchPlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              {filterOptions.map((opt) => {
                const active = filter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setFilter(opt.key)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.btnGhost} onPress={() => void loadContacts()}>
                  <Text style={styles.btnGhostText}>{t("createProject.ai.retry")}</Text>
                </TouchableOpacity>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.centerBox}>
                <Text style={styles.muted}>{t("business.contacts.empty")}</Text>
              </View>
            ) : (
              <ScrollView style={styles.listScroll} keyboardShouldPersistTaps="handled">
                {filtered.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.row}
                    onPress={() => {
                      onSelect(c);
                      onDismiss();
                    }}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{c.displayName}</Text>
                      {c.companyName ? <Text style={styles.rowSub}>{c.companyName}</Text> : null}
                      <Text style={styles.rowMeta}>
                        {t(contactTypeLabelKey(c.contactType))}
                        {c.phone ? ` · ${c.phone}` : ""}
                        {c.email ? ` · ${c.email}` : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode("create")}>
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.btnSecondaryText}>{t("createProject.newJob.contact.createNewInPicker")}</Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    maxHeight: "88%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.text, flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
    marginBottom: spacing.sm,
  },
  textArea: { minHeight: 72 },
  filterScroll: { marginBottom: spacing.sm, maxHeight: 44 },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
    backgroundColor: colors.card,
  },
  filterChipActive: {
    backgroundColor: "rgba(224, 103, 55, 0.12)",
    borderColor: colors.primary,
  },
  filterChipText: { fontSize: 13, color: colors.textMuted },
  filterChipTextActive: { color: colors.primary, fontWeight: "600" },
  listScroll: { maxHeight: 320 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, marginRight: spacing.sm },
  rowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  centerBox: { paddingVertical: spacing.xl, alignItems: "center" },
  muted: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  errorText: { fontSize: 14, color: colors.error, textAlign: "center", marginBottom: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  btnSecondaryText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  btnGhost: { paddingVertical: spacing.md, alignItems: "center" },
  btnGhostText: { color: colors.primary, fontSize: 15 },
  btnDisabled: { opacity: 0.6 },
});
