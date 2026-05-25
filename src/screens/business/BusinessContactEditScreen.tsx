import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import {
  BUSINESS_CONTACT_TYPES,
  createBusinessContact,
  getBusinessContact,
  updateBusinessContact,
  type BusinessContactType,
} from "../../services/businessContacts";
import { colors, spacing } from "../../theme";

type RouteParams = { contactId?: string };

function contactTypeLabelKey(type: BusinessContactType): string {
  return `business.contacts.type.${type}`;
}

export function BusinessContactEditScreen() {
  const { t } = useI18n();
  const route = useRoute();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: object) => void;
    goBack: () => void;
  };
  const contactId = (route.params as RouteParams | undefined)?.contactId;
  const isEdit = !!contactId?.trim();
  const { activeBusinessOrgId } = useActiveOrg();
  const { canManageContacts } = useOrgAccess();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactType, setContactType] = useState<BusinessContactType>("customer");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!isEdit || !activeBusinessOrgId || !contactId) return;
    let cancelled = false;
    setLoading(true);
    getBusinessContact(activeBusinessOrgId, contactId)
      .then((row) => {
        if (cancelled || !row) return;
        setDisplayName(row.displayName);
        setCompanyName(row.companyName ?? "");
        setContactType(row.contactType);
        setEmail(row.email ?? "");
        setPhone(row.phone ?? "");
        setAddress(row.address ?? "");
        setNotes(row.notes ?? "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBusinessOrgId, contactId, isEdit]);

  const onSave = useCallback(async () => {
    const name = displayName.trim();
    if (!name) {
      Alert.alert("", t("business.contacts.displayNameRequired"));
      return;
    }
    if (!activeBusinessOrgId) return;
    setSaving(true);
    try {
      if (isEdit && contactId) {
        await updateBusinessContact(activeBusinessOrgId, contactId, {
          displayName: name,
          companyName: companyName.trim() || undefined,
          contactType,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        navigation.navigate("BusinessContactDetail", { contactId });
      } else {
        const id = await createBusinessContact(activeBusinessOrgId, {
          displayName: name,
          companyName: companyName.trim() || undefined,
          contactType,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        navigation.navigate("BusinessContactDetail", { contactId: id });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert(t("common.error"), msg || t("business.contacts.saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    activeBusinessOrgId,
    address,
    companyName,
    contactId,
    contactType,
    displayName,
    email,
    isEdit,
    navigation,
    notes,
    phone,
    t,
  ]);

  if (!canManageContacts) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t("business.contacts.manageDenied")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.fieldLabel}>{t("business.contacts.displayName")} *</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t("business.contacts.displayNamePlaceholder")}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.fieldLabel}>{t("business.contacts.companyName")}</Text>
      <TextInput
        style={styles.input}
        value={companyName}
        onChangeText={setCompanyName}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.fieldLabel}>{t("business.contacts.contactType")} *</Text>
      <View style={styles.typeWrap}>
        {BUSINESS_CONTACT_TYPES.map((type) => {
          const active = contactType === type;
          return (
            <TouchableOpacity
              key={type}
              style={[styles.typeChip, active && styles.typeChipActive]}
              onPress={() => setContactType(type)}
            >
              <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                {t(contactTypeLabelKey(type))}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>{t("business.contacts.email")}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.fieldLabel}>{t("business.contacts.phone")}</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.fieldLabel}>{t("business.contacts.address")}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={address}
        onChangeText={setAddress}
        multiline
        textAlignVertical="top"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.fieldLabel}>{t("business.contacts.notes")}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={notes}
        onChangeText={setNotes}
        multiline
        textAlignVertical="top"
        placeholderTextColor={colors.textMuted}
      />

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.btnDisabled]}
        disabled={saving}
        onPress={() => void onSave()}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>
            {isEdit ? t("business.contacts.saveChanges") : t("business.contacts.createCta")}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { color: colors.textOnDark, fontSize: 15 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.labelOnDark,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  textArea: { minHeight: 88 },
  typeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { borderColor: colors.primary, backgroundColor: "rgba(224, 103, 55, 0.12)" },
  typeChipText: { fontSize: 13, color: colors.textMuted },
  typeChipTextActive: { color: colors.primary, fontWeight: "600" },
  saveBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
});
