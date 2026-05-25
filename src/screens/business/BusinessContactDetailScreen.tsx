import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import {
  archiveBusinessContact,
  getBusinessContact,
  type BusinessContact,
  type BusinessContactType,
} from "../../services/businessContacts";
import { colors, spacing } from "../../theme";

type RouteParams = { contactId?: string };

function contactTypeLabelKey(type: BusinessContactType): string {
  return `business.contacts.type.${type}`;
}

export function BusinessContactDetailScreen() {
  const { t } = useI18n();
  const route = useRoute();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: object) => void;
    goBack: () => void;
  };
  const contactId = (route.params as RouteParams | undefined)?.contactId ?? "";
  const { activeBusinessOrgId } = useActiveOrg();
  const { canManageContacts } = useOrgAccess();
  const [contact, setContact] = useState<BusinessContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    if (!activeBusinessOrgId || !contactId) {
      setContact(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const row = await getBusinessContact(activeBusinessOrgId, contactId);
      setContact(row);
    } catch {
      setContact(null);
    } finally {
      setLoading(false);
    }
  }, [activeBusinessOrgId, contactId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onArchive = () => {
    if (!activeBusinessOrgId || !contactId || !contact) return;
    Alert.alert(t("business.contacts.archiveTitle"), t("business.contacts.archiveMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("business.contacts.archiveConfirm"),
        style: "destructive",
        onPress: () => {
          setArchiving(true);
          archiveBusinessContact(activeBusinessOrgId, contactId)
            .then(() => navigation.goBack())
            .catch((e) => {
              const msg = e instanceof Error ? e.message : String(e ?? "");
              Alert.alert(t("common.error"), msg || t("business.contacts.archiveError"));
            })
            .finally(() => setArchiving(false));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!contact) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t("business.contacts.notFound")}</Text>
      </View>
    );
  }

  const isArchived = contact.archivedAt != null && contact.archivedAt !== "";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{contact.displayName}</Text>
      {contact.companyName ? <Text style={styles.company}>{contact.companyName}</Text> : null}
      <Text style={styles.badge}>{t(contactTypeLabelKey(contact.contactType))}</Text>
      {isArchived ? (
        <Text style={styles.archivedBadge}>{t("business.contacts.archivedLabel")}</Text>
      ) : null}

      {contact.phone ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t("business.contacts.phone")}</Text>
          <Text style={styles.fieldValue}>{contact.phone}</Text>
        </View>
      ) : null}
      {contact.email ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t("business.contacts.email")}</Text>
          <Text style={styles.fieldValue}>{contact.email}</Text>
        </View>
      ) : null}
      {contact.address ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t("business.contacts.address")}</Text>
          <Text style={styles.fieldValue}>{contact.address}</Text>
        </View>
      ) : null}
      {contact.notes ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t("business.contacts.notes")}</Text>
          <Text style={styles.fieldValue}>{contact.notes}</Text>
        </View>
      ) : null}

      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderTitle}>{t("business.contacts.relatedJobs")}</Text>
        <Text style={styles.placeholderBody}>{t("business.contacts.comingSoon")}</Text>
      </View>
      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderTitle}>{t("business.contacts.relatedDocuments")}</Text>
        <Text style={styles.placeholderBody}>{t("business.contacts.comingSoon")}</Text>
      </View>
      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderTitle}>{t("business.contacts.relatedNotes")}</Text>
        <Text style={styles.placeholderBody}>{t("business.contacts.comingSoon")}</Text>
      </View>
      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderTitle}>{t("business.contacts.relatedCommunication")}</Text>
        <Text style={styles.placeholderBody}>{t("business.contacts.comingSoon")}</Text>
      </View>

      {canManageContacts && !isArchived ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              navigation.navigate("BusinessContactEdit", { contactId: contact.id })
            }
          >
            <Text style={styles.primaryBtnText}>{t("business.contacts.editCta")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dangerBtn, archiving && styles.btnDisabled]}
            disabled={archiving}
            onPress={onArchive}
          >
            <Text style={styles.dangerBtnText}>{t("business.contacts.archiveCta")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { color: colors.textOnDark, fontSize: 15 },
  name: { fontSize: 24, fontWeight: "800", color: colors.textOnDark },
  company: { fontSize: 16, color: colors.onboardingHelperOnDark, marginTop: 4 },
  badge: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  archivedBadge: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.error,
    fontWeight: "600",
  },
  field: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted, marginBottom: 4 },
  fieldValue: { fontSize: 15, color: colors.text },
  placeholderCard: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    opacity: 0.92,
  },
  placeholderTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  placeholderBody: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  dangerBtnText: { color: colors.error, fontWeight: "600", fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
