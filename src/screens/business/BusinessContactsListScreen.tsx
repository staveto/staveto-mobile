import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import {
  BUSINESS_CONTACT_TYPES,
  listBusinessContacts,
  type BusinessContact,
  type BusinessContactType,
} from "../../services/businessContacts";
import { colors, spacing } from "../../theme";

type FilterKey = "all" | BusinessContactType;

function contactTypeLabelKey(type: BusinessContactType): string {
  return `business.contacts.type.${type}`;
}

function ContactRow({
  item,
  onPress,
}: {
  item: BusinessContact;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const meta = [item.phone, item.email].filter(Boolean).join(" · ");
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.displayName}
        </Text>
        {item.companyName ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.companyName}
          </Text>
        ) : null}
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{t(contactTypeLabelKey(item.contactType))}</Text>
        </View>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {item.address ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {item.address}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

export function BusinessContactsListScreen() {
  const { t } = useI18n();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: object) => void;
  };
  const { activeBusinessOrgId } = useActiveOrg();
  const { canViewContacts, canManageContacts } = useOrgAccess();
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!activeBusinessOrgId) {
      setContacts([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const rows = await listBusinessContacts(activeBusinessOrgId, {
        includeArchived: showArchived,
        contactType: filter === "all" ? undefined : filter,
      });
      setContacts(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      setError(msg || t("business.contacts.loadError"));
      setContacts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeBusinessOrgId, filter, showArchived, t]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  React.useEffect(() => {
    setLoading(true);
    void load();
  }, [filter, showArchived, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const blob = [c.displayName, c.companyName, c.email, c.phone, c.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [contacts, search]);

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

  if (!canViewContacts) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t("business.contacts.accessDenied")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={t("business.contacts.searchPlaceholder")}
          placeholderTextColor={colors.textMuted}
        />
        {canManageContacts ? (
          <View style={styles.archivedRow}>
            <Text style={styles.archivedLabel}>{t("business.contacts.showArchived")}</Text>
            <Switch
              value={showArchived}
              onValueChange={setShowArchived}
            />
          </View>
        ) : null}
      </View>
      <FlatList
        horizontal
        data={filterOptions}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        style={styles.filterList}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item: opt }) => {
          const active = filter === opt.key;
          return (
            <TouchableOpacity
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(opt.key)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>{t("business.contacts.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={
            filtered.length === 0 ? styles.emptyListContent : styles.listContent
          }
          ListEmptyComponent={
            <Text style={styles.muted}>{t("business.contacts.empty")}</Text>
          }
          renderItem={({ item }) => (
            <ContactRow
              item={item}
              onPress={() =>
                navigation.navigate("BusinessContactDetail", { contactId: item.id })
              }
            />
          )}
        />
      )}
      {canManageContacts ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate("BusinessContactEdit", {})}
          accessibilityRole="button"
          accessibilityLabel={t("business.contacts.createCta")}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  search: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  archivedLabel: { color: colors.textOnDark, fontSize: 14 },
  filterList: { maxHeight: 48, marginBottom: spacing.xs },
  filterContent: { paddingHorizontal: spacing.md, gap: spacing.xs },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginRight: spacing.xs,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(224, 103, 55, 0.15)",
  },
  filterChipText: { fontSize: 13, color: colors.textMuted },
  filterChipTextActive: { color: colors.primary, fontWeight: "600" },
  listContent: { paddingBottom: 88 },
  emptyListContent: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: 12,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  rowSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  badgeRow: { marginTop: 4 },
  badge: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
    backgroundColor: "rgba(224, 103, 55, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  muted: { fontSize: 15, color: colors.textOnDark, textAlign: "center", opacity: 0.9 },
  error: { fontSize: 14, color: colors.error, textAlign: "center", marginBottom: spacing.md },
  retryBtn: { padding: spacing.md },
  retryText: { color: colors.primary, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
});
