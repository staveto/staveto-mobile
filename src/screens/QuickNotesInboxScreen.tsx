import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import * as quickNotesService from "../services/quickNotes";
import type { QuickNote } from "../services/quickNotes";
import { QuickNoteModal } from "../components/QuickNoteModal";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateYmd(ymd: string): string {
  const today = new Date().toISOString().split("T")[0];
  if (ymd === today) return "Dnes";
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (ymd === yesterday) return "Včera";
  try {
    const [y, m, d] = ymd.split("-");
    return `${d}.${m}.${y}`;
  } catch {
    return ymd;
  }
}

export function QuickNotesInboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { user } = useAuth();
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<"today" | "all">("today");

  const loadNotes = useCallback(async (isRefresh = false) => {
    if (!user?.id) {
      setNotes([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const list =
        filter === "today"
          ? await quickNotesService.listTodayNotes(user.id)
          : await quickNotesService.listQuickNotes(user.id);
      setNotes(list);
    } catch (e) {
      if (__DEV__) console.warn("[QuickNotesInbox] load failed:", e);
      setNotes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, filter]);

  useFocusEffect(
    useCallback(() => {
      loadNotes(false);
    }, [loadNotes])
  );

  const onRefresh = useCallback(() => loadNotes(true), [loadNotes]);

  const handleDelete = useCallback(
    (note: QuickNote) => {
      Alert.alert(
        t("common.delete") || "Vymazať",
        t("quickNotes.confirmDelete") || "Naozaj chcete vymazať tento zápis?",
        [
          { text: t("common.cancel") || "Zrušiť", style: "cancel" },
          {
            text: t("common.delete") || "Vymazať",
            style: "destructive",
            onPress: async () => {
              if (!user?.id) return;
              await quickNotesService.deleteQuickNote(user.id, note.id);
              setNotes((prev) => prev.filter((n) => n.id !== note.id));
            },
          },
        ]
      );
    },
    [user?.id, t]
  );

  const handleAddNote = useCallback(
    async (text: string) => {
      if (!user?.id) return;
      await quickNotesService.addQuickNote(user.id, text);
      await loadNotes(true);
    },
    [user?.id, loadNotes]
  );

  const renderItem = useCallback(
    ({ item }: { item: QuickNote }) => (
      <View style={styles.noteRow}>
        <View style={styles.noteContent}>
          <Text style={styles.noteText}>{item.text}</Text>
          <Text style={styles.noteMeta}>
            {formatDateYmd(item.dateYmd)} • {formatTime(item.createdAt)}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDelete(item)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="trash-outline" size={22} color={colors.error} />
        </TouchableOpacity>
      </View>
    ),
    [handleDelete]
  );

  const ListHeader = (
    <View style={styles.filterRow}>
      <TouchableOpacity
        style={[styles.filterBtn, filter === "today" && styles.filterBtnActive]}
        onPress={() => setFilter("today")}
      >
        <Text style={[styles.filterText, filter === "today" && styles.filterTextActive]}>
          {t("quickNotes.today") || "Dnes"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.filterBtn, filter === "all" && styles.filterBtnActive]}
        onPress={() => setFilter("all")}
      >
        <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>
          {t("quickNotes.all") || "Všetky"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const ListEmpty = (
    <View style={styles.empty}>
      <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>
        {filter === "today"
          ? (t("quickNotes.emptyToday") || "Dnes nemáte žiadne zápisky. Pridajte prvý!")
          : (t("quickNotes.emptyAll") || "Nemáte žiadne zápisky.")}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.title}>{t("quickNotes.title") || "Rýchle zápisky"}</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {ListHeader}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={notes.length === 0 ? styles.listEmpty : styles.list}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        />
      )}

      <QuickNoteModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {}}
        onSubmit={handleAddNote}
        placeholder={t("quickNotes.placeholder") || "Čo si chcete zapamätať?"}
        saveLabel={t("quickNotes.save") || "Uložiť"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  filterBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: 14,
    color: colors.textOnDark,
    opacity: 0.9,
  },
  filterTextActive: {
    color: "#fff",
    fontWeight: "600",
    opacity: 1,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  listEmpty: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteContent: {
    flex: 1,
  },
  noteText: {
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  noteMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  deleteBtn: {
    padding: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
