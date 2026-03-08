/**
 * Vizualný prehľad denníka – posledné zápisy v atraktívnom layoute.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as constructionDiaryService from "../services/constructionDiary";
import * as attachmentsService from "../services/attachments";
import * as storageSmart from "../services/storageSmart";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { DiaryEntryDoc } from "../services/constructionDiary";

function getWeatherIcon(weather?: string): string {
  if (!weather) return "partly-sunny-outline";
  const w = weather.toLowerCase();
  if (w.includes("sun") || w.includes("jasno") || w.includes("sunny")) return "sunny-outline";
  if (w.includes("cloud") || w.includes("oblač") || w.includes("cloudy")) return "cloudy-outline";
  if (w.includes("rain") || w.includes("dáž") || w.includes("rainy")) return "rainy-outline";
  if (w.includes("snow") || w.includes("sneh")) return "snow-outline";
  if (w.includes("storm") || w.includes("búr")) return "thunderstorm-outline";
  return "partly-sunny-outline";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatDayShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.getDate().toString();
  } catch {
    return "?";
  }
}

function formatMonthShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", { month: "short" });
  } catch {
    return "";
  }
}

export function ProjectDiaryOverviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const params = (route.params as { projectId?: string; projectName?: string; projectType?: string }) ?? {};
  const projectId = params.projectId ?? "";
  const projectName = params.projectName ?? "";
  const { isOffline, isPoorNetwork } = useOnlineStatus();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<DiaryEntryDoc[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await constructionDiaryService.listDiaryEntries(projectId).catch(() => []);
        const sorted = [...list].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setEntries(sorted);

        const onlineStatus = { isOffline, isPoorNetwork };
        const urlMap = new Map<string, string>();
        for (const entry of sorted.slice(0, 8)) {
          if (entry.attachments && entry.attachments.length > 0) {
            for (const attId of entry.attachments) {
              try {
                const att = await attachmentsService.getAttachment(projectId, attId);
                if (att?.fileType === "image") {
                  const cached = (att as { downloadURL?: string }).downloadURL;
                  const url = cached ?? (await storageSmart.getDownloadUrlSmart(att.storagePath, onlineStatus));
                  if (url) {
                    urlMap.set(entry.id, url);
                    break;
                  }
                }
              } catch {
                // skip
              }
            }
          }
        }
        setPreviewUrls(urlMap);
      } catch (e) {
        console.error("[ProjectDiaryOverview] Load error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, isOffline, isPoorNetwork]
  );

  useEffect(() => {
    load();
  }, [load]);

  const goBack = () => (navigation as any).goBack();
  const goToProjectOverview = () =>
    (navigation as any).navigate("ProjectOverview", {
      projectId,
      projectName,
      projectType: params.projectType,
      openDiaryModal: false,
    });

  if (!projectId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{t("projectOverview.projectNotFound")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("diaryOverview.title") || "Denník projektu"}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="journal" size={48} color="#4a9fd9" />
          </View>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {projectName || t("projects.noName")}
          </Text>
          <Text style={styles.heroSubtitle}>
            {t("diaryOverview.subtitle") || "Posledné zápisy zo stavby"}
          </Text>
          <View style={styles.heroBadge}>
            <Ionicons name="document-text" size={18} color={colors.textOnDark} />
            <Text style={styles.heroBadgeText}>
              {entries.length} {t("diaryOverview.entries")}
            </Text>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("projectOverviewDashboard.diaryTitle")}
          </Text>

          {entries.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="journal-outline" size={56} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {t("projectOverview.noDiaryEntries")}
              </Text>
              <Text style={styles.emptyHint}>
                {t("diaryOverview.noEntriesHint")}
              </Text>
            </View>
          ) : (
            entries.map((entry, index) => {
              const previewUrl = previewUrls.get(entry.id);
              const hasAttachments = entry.attachments && entry.attachments.length > 0;
              return (
                <View key={entry.id} style={styles.entryCard}>
                  <View style={styles.entryLeft}>
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateDay}>{formatDayShort(entry.date)}</Text>
                      <Text style={styles.dateMonth}>{formatMonthShort(entry.date)}</Text>
                    </View>
                    {index < entries.length - 1 && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.entryContent}>
                    {previewUrl ? (
                      <Image source={{ uri: previewUrl }} style={styles.entryImage} resizeMode="cover" />
                    ) : hasAttachments ? (
                      <View style={[styles.entryImage, styles.entryImagePlaceholder]}>
                        <Ionicons name="image" size={32} color={colors.primary} />
                      </View>
                    ) : null}
                    <View style={styles.entryBody}>
                      <Text style={styles.entryDesc} numberOfLines={3}>
                        {entry.workDescription || "—"}
                      </Text>
                      <View style={styles.entryMeta}>
                        {entry.weather && (
                          <View style={styles.metaRow}>
                            <Ionicons
                              name={getWeatherIcon(entry.weather) as any}
                              size={16}
                              color={colors.textMuted}
                            />
                            <Text style={styles.metaText}>{entry.weather}</Text>
                          </View>
                        )}
                        {entry.workers && (
                          <View style={styles.metaRow}>
                            <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                            <Text style={styles.metaText}>{entry.workers}</Text>
                          </View>
                        )}
                        {hasAttachments && (
                          <View style={styles.metaRow}>
                            <Ionicons name="image-outline" size={16} color={colors.primary} />
                            <Text style={styles.metaText}>
                              {entry.attachments!.length} {t("diaryOverview.photos")}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <TouchableOpacity style={styles.ctaButton} onPress={goToProjectOverview} activeOpacity={0.8}>
          <Text style={styles.ctaButtonText}>
            {t("projectOverviewDashboard.openDiary")}
          </Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  headerBack: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroIconWrap: {
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginTop: spacing.xs,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius,
  },
  heroBadgeText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radius,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.9)",
    marginTop: spacing.md,
  },
  emptyHint: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    marginTop: spacing.xs,
    textAlign: "center",
  },
  entryCard: {
    flexDirection: "row",
    marginBottom: spacing.md,
  },
  entryLeft: {
    width: 56,
    alignItems: "center",
  },
  dateBadge: {
    width: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    alignItems: "center",
  },
  dateDay: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.textOnDark,
    lineHeight: 24,
  },
  dateMonth: {
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginTop: spacing.sm,
    minHeight: 24,
  },
  entryContent: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  entryImage: {
    width: 80,
    height: 80,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  entryImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  entryBody: {
    flex: 1,
    padding: spacing.md,
    justifyContent: "center",
  },
  entryDesc: {
    fontSize: 14,
    color: colors.textOnDark,
    lineHeight: 20,
  },
  entryMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  errorText: {
    color: colors.textOnDark,
    padding: spacing.lg,
  },
});
