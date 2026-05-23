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
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { useI18n } from "../../i18n/I18nContext";
import {
  archiveBusinessCustomer,
  getBusinessCustomer,
  type BusinessCustomer,
} from "../../services/businessCustomers";
import { colors } from "../../theme";

type RouteParams = { customerId?: string };

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function BusinessCustomerDetailScreen() {
  const { t } = useI18n();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: { customerId?: string }) => void;
    goBack: () => void;
  };
  const route = useRoute() as { params?: RouteParams };
  const customerId = route.params?.customerId ?? "";
  const { activeOrganization } = useActiveOrg();
  const { canManageCustomers, canViewCustomers } = useOrgAccess();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<BusinessCustomer | null>(null);

  const load = useCallback(async () => {
    const orgId = activeOrganization?.id;
    if (!orgId || !customerId || !canViewCustomers) {
      setCustomer(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const doc = await getBusinessCustomer(orgId, customerId);
      setCustomer(doc);
    } catch (error) {
      console.warn("[BusinessCustomerDetail] load failed", error);
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, [activeOrganization?.id, canViewCustomers, customerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onArchive = () => {
    const orgId = activeOrganization?.id;
    if (!orgId || !customer || !canManageCustomers) return;
    Alert.alert(t("business.customers.detail.archive"), t("business.customers.detail.archiveConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("business.customers.detail.archive"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await archiveBusinessCustomer(orgId, customer.id);
              Alert.alert("", t("business.customers.detail.archiveDone"));
              navigation.goBack();
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              Alert.alert(t("common.error"), msg);
            }
          })();
        },
      },
    ]);
  };

  if (!canViewCustomers) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t("business.customers.noAccess")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t("business.customers.notFound")}</Text>
      </View>
    );
  }

  const isArchived = customer.archivedAt != null && customer.archivedAt !== "";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{customer.displayName}</Text>
      {customer.companyName ? <Text style={styles.company}>{customer.companyName}</Text> : null}
      {isArchived ? (
        <Text style={styles.archivedBadge}>{t("business.customers.archivedBadge")}</Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("business.customers.detail.section.contact")}</Text>
        <DetailRow label={t("business.customers.edit.email")} value={customer.email} />
        <DetailRow label={t("business.customers.edit.phone")} value={customer.phone} />
        <DetailRow label={t("business.customers.edit.address")} value={customer.address} />
      </View>

      {customer.notes ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("business.customers.detail.section.notes")}</Text>
          <Text style={styles.notesBody}>{customer.notes}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("business.customers.detail.future.title")}</Text>
        <Text style={styles.futureLine}>{t("business.customers.detail.future.jobs")}</Text>
        <Text style={styles.futureLine}>{t("business.customers.detail.future.offers")}</Text>
        <Text style={styles.futureLine}>{t("business.customers.detail.future.documents")}</Text>
      </View>

      {canManageCustomers && !isArchived ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate("BusinessCustomerEdit", { customerId: customer.id })}
          >
            <Text style={styles.primaryBtnText}>{t("business.customers.detail.edit")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={onArchive}>
            <Text style={styles.dangerBtnText}>{t("business.customers.detail.archive")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0E1D3A" },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  centered: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "800", color: "#fff" },
  company: { fontSize: 16, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  archivedBadge: {
    alignSelf: "flex-start",
    marginTop: 8,
    fontSize: 12,
    fontWeight: "600",
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 4 },
  detailRow: { gap: 2 },
  detailLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  detailValue: { fontSize: 15, color: colors.text, lineHeight: 20 },
  notesBody: { fontSize: 15, color: colors.text, lineHeight: 22 },
  futureLine: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  actions: { gap: 10, marginTop: 8 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  dangerBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  dangerBtnText: { color: "#FCA5A5", fontWeight: "600", fontSize: 15 },
  muted: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    margin: 24,
  },
});
