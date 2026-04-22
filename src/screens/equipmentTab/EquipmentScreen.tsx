import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import * as userEquipmentService from "../../services/userEquipment";
import type { UserEquipmentDoc, UserEquipmentStatus } from "../../services/userEquipment";
import {
  runLegacyUserEquipmentMigration,
  shouldThrottleLegacyUserEquipmentMigration,
  markLegacyUserEquipmentMigrationRan,
  LEGACY_USER_EQUIPMENT_MIGRATION_THROTTLE_MS,
} from "../../services/legacyUserEquipmentMigration";
import type { EquipmentStackParamList } from "../../navigation/EquipmentStack";

type Nav = NativeStackNavigationProp<EquipmentStackParamList, "EquipmentMain">;

type FilterKey = "all" | UserEquipmentStatus;

const FILTERS: FilterKey[] = ["all", "available", "assigned", "in_service"];

const PILL_RADIUS = 9999;

function categoryLabelKey(category: string): string {
  const map: Record<string, string> = {
    machine: "equipment.categoryMachine",
    tool: "equipment.categoryTool",
    vehicle: "equipment.categoryVehicle",
    building: "equipment.categoryBuilding",
    other: "equipment.categoryOther",
  };
  return map[category] ?? "equipment.categoryOther";
}

function statusLabelKey(s: UserEquipmentStatus): string {
  switch (s) {
    case "available":
      return "equipmentTab.status.available";
    case "assigned":
      return "equipmentTab.status.assigned";
    case "in_service":
      return "equipmentTab.status.inService";
    case "inactive":
      return "equipmentTab.status.inactive";
    default:
      return "equipmentTab.status.available";
  }
}

function statusPillStyle(s: UserEquipmentStatus) {
  if (s === "available") return { backgroundColor: "rgba(46, 204, 113, 0.22)" };
  if (s === "assigned") return { backgroundColor: "rgba(93, 173, 226, 0.28)" };
  if (s === "in_service") return { backgroundColor: "rgba(241, 196, 15, 0.28)" };
  return { backgroundColor: "rgba(149, 165, 166, 0.28)" };
}

export function EquipmentScreen() {
  const { t } = useI18n();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.id ?? "";

  const [items, setItems] = useState<UserEquipmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const list = await userEquipmentService.listUserEquipment(uid, {
        status: filter === "all" ? "all" : filter,
      });
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid, filter]);

  const maybeMigrateLegacy = useCallback(
    async (opts: { force: boolean }) => {
      if (!uid) return;
      try {
        if (!opts.force && (await shouldThrottleLegacyUserEquipmentMigration(LEGACY_USER_EQUIPMENT_MIGRATION_THROTTLE_MS))) {
          return;
        }
        await runLegacyUserEquipmentMigration(uid);
        await markLegacyUserEquipmentMigrationRan();
      } catch (e) {
        if (__DEV__) console.warn("[EquipmentScreen] legacy user equipment migration:", e);
      }
    },
    [uid]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await maybeMigrateLegacy({ force: false });
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load, maybeMigrateLegacy])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (async () => {
      await maybeMigrateLegacy({ force: true });
      await load();
    })();
  }, [load, maybeMigrateLegacy]);

  const qLow = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qLow) return items;
    return items.filter((row) => {
      const blob = [row.name, row.category, row.kind ?? "", row.internalCode ?? "", row.locationText ?? ""]
        .join(" ")
        .toLowerCase();
      return blob.includes(qLow);
    });
  }, [items, qLow]);

  const stats = useMemo(() => {
    let assigned = 0;
    let inService = 0;
    for (const row of items) {
      if (row.status === "assigned") assigned += 1;
      if (row.status === "in_service") inService += 1;
    }
    return { total: items.length, assigned, inService };
  }, [items]);

  const renderItem = useCallback(
    ({ item }: { item: UserEquipmentDoc }) => (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.88}
        onPress={() => navigation.navigate("EquipmentDetail", { equipmentId: item.id })}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={[styles.statusPill, statusPillStyle(item.status)]}>
            <Text style={styles.statusPillText}>{t(statusLabelKey(item.status))}</Text>
          </View>
        </View>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {t(categoryLabelKey(String(item.category)))}
          {item.kind ? ` · ${item.kind}` : ""}
        </Text>
        {(item.locationText || item.assignedProjectId) && (
          <Text style={styles.cardSub} numberOfLines={1}>
            {item.assignedProjectId ? t("equipmentTab.rowAssignedShort") : item.locationText}
          </Text>
        )}
      </TouchableOpacity>
    ),
    [navigation, t]
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <View style={styles.introCard}>
          <Text style={styles.introTitle}>{t("equipmentTab.listIntroTitle")}</Text>
          <Text style={styles.introSubtitle}>{t("equipmentTab.listIntroSubtitle")}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>{t("equipmentTab.statTotal")}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{stats.assigned}</Text>
            <Text style={styles.statLabel}>{t("equipmentTab.statAssigned")}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{stats.inService}</Text>
            <Text style={styles.statLabel}>{t("equipmentTab.statInService")}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryCta} onPress={() => navigation.navigate("EquipmentForm", {})} activeOpacity={0.9}>
          <Ionicons name="add-circle" size={22} color="#fff" />
          <Text style={styles.primaryCtaText}>{t("equipmentTab.addCta")}</Text>
        </TouchableOpacity>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={t("equipmentTab.searchPlaceholder")}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>

        <View style={styles.chipsRow}>
          {FILTERS.map((key) => {
            const active = filter === key;
            const label =
              key === "all"
                ? t("equipmentTab.filterAll")
                : key === "available"
                  ? t("equipmentTab.filterAvailable")
                  : key === "assigned"
                    ? t("equipmentTab.filterAssigned")
                    : t("equipmentTab.filterInService");
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    ),
    [filter, navigation, q, stats, t]
  );

  const isSearchEmpty = qLow.length > 0 && filtered.length === 0 && items.length > 0;

  const listEmpty = useMemo(() => {
    if (isSearchEmpty) {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconRing}>
            <Ionicons name="search-outline" size={36} color={colors.labelOnDark} />
          </View>
          <Text style={styles.emptyTitle}>{t("equipmentTab.emptySearch")}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconRing}>
          <Ionicons name="construct" size={38} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>{t("equipmentTab.emptyTitle")}</Text>
        <Text style={styles.emptyBody}>{t("equipmentTab.emptyBody")}</Text>
        <Text style={styles.emptyHint}>{t("equipmentTab.emptyHint")}</Text>
      </View>
    );
  }, [isSearchEmpty, t]);

  if (!uid) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.mutedOnDark}>{t("equipmentTab.signInHint")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + spacing.xl },
            filtered.length === 0 ? styles.listContentEmpty : null,
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loadingBlock: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  headerBlock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  introCard: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  introTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.2,
  },
  introSubtitle: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCell: {
    flex: 1,
    backgroundColor: colors.chipOnDarkBg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.chipOnDarkBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.labelOnDark,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    color: colors.labelMutedOnDark,
    textAlign: "center",
  },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    marginBottom: spacing.md,
  },
  primaryCtaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  searchIcon: { marginLeft: spacing.xs },
  searchInput: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? spacing.md : spacing.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: PILL_RADIUS,
    borderWidth: 1,
    borderColor: colors.chipOnDarkBorder,
    backgroundColor: colors.chipOnDarkBg,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.labelMutedOnDark, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  listContent: { paddingTop: 0 },
  listContentEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardName: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "700" },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: PILL_RADIUS },
  statusPillText: { fontSize: 11, fontWeight: "700", color: colors.text },
  cardMeta: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 14 },
  cardSub: { marginTop: 4, color: colors.textMuted, fontSize: 13 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  mutedOnDark: { color: colors.labelMutedOnDark, fontSize: 15, textAlign: "center", paddingHorizontal: spacing.lg },
  emptyWrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    minHeight: 280,
  },
  emptyIconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: colors.chipOnDarkBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.labelOnDark,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  emptyBody: {
    marginTop: spacing.sm,
    color: colors.labelMutedOnDark,
    textAlign: "center",
    lineHeight: 22,
    fontSize: 15,
    fontWeight: "500",
    maxWidth: 320,
  },
  emptyHint: {
    marginTop: spacing.md,
    color: colors.labelMutedOnDark,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 300,
    opacity: 0.95,
  },
});
