import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { useI18n } from "../../i18n/I18nContext";
import { listBusinessCustomers, type BusinessCustomer } from "../../services/businessCustomers";
import { colors } from "../../theme";

function customerSubtitle(customer: BusinessCustomer): string {
  const parts = [customer.companyName, customer.phone, customer.email, customer.address].filter(
    Boolean
  ) as string[];
  return parts.join(" · ");
}

export function BusinessCustomersListScreen() {
  const { t } = useI18n();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: { customerId?: string }) => void;
  };
  const { activeOrganization } = useActiveOrg();
  const { canManageCustomers, canViewCustomers } = useOrgAccess();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BusinessCustomer[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const loadCustomers = useCallback(async () => {
    const orgId = activeOrganization?.id;
    if (!orgId || !canViewCustomers) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listBusinessCustomers(orgId, { includeArchived: showArchived });
      setRows(list);
    } catch (error) {
      console.warn("[BusinessCustomersList] load failed", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeOrganization?.id, canViewCustomers, showArchived]);

  useFocusEffect(
    useCallback(() => {
      void loadCustomers();
    }, [loadCustomers])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => {
      const haystack = [
        c.displayName,
        c.companyName,
        c.email,
        c.phone,
        c.address,
        c.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, rows]);

  const openCreate = () => {
    navigation.navigate("BusinessCustomerEdit", {});
  };

  const openDetail = (customerId: string) => {
    navigation.navigate("BusinessCustomerDetail", { customerId });
  };

  if (!canViewCustomers) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>{t("business.customers.noAccess")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>{t("business.customers.title")}</Text>
        {canManageCustomers ? (
          <TouchableOpacity style={styles.addBtn} onPress={openCreate} accessibilityRole="button">
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.addBtnText}>{t("business.customers.add")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={t("business.customers.searchPlaceholder")}
        placeholderTextColor="rgba(255,255,255,0.45)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {canManageCustomers ? (
        <TouchableOpacity
          style={styles.archivedToggle}
          onPress={() => setShowArchived((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showArchived }}
        >
          <Text style={styles.archivedToggleText}>{t("business.customers.showArchived")}</Text>
          <Ionicons
            name={showArchived ? "checkbox" : "square-outline"}
            size={20}
            color={showArchived ? colors.primary : "rgba(255,255,255,0.7)"}
          />
        </TouchableOpacity>
      ) : null}

      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

      <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 && !loading ? (
          <Text style={styles.empty}>{t("business.customers.empty")}</Text>
        ) : (
          filtered.map((customer) => {
            const archived =
              customer.archivedAt != null && customer.archivedAt !== "";
            const subtitle = customerSubtitle(customer);
            return (
              <TouchableOpacity
                key={customer.id}
                style={styles.row}
                onPress={() => openDetail(customer.id)}
                accessibilityRole="button"
              >
                <View style={styles.rowTextCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.primaryName} numberOfLines={1}>
                      {customer.displayName}
                    </Text>
                    {archived ? (
                      <Text style={styles.archivedBadge}>{t("business.customers.archivedBadge")}</Text>
                    ) : null}
                  </View>
                  {subtitle ? (
                    <Text style={styles.subtitle} numberOfLines={2}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  pageTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  search: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  archivedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingVertical: 4,
  },
  archivedToggleText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
  },
  loader: { marginVertical: 12 },
  listContent: { paddingBottom: 28, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  rowTextCol: { flex: 1, minWidth: 0 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  primaryName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
  },
  archivedBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  empty: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 22,
  },
});
