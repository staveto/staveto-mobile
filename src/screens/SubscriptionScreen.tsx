/**
 * Subscription Management Screen
 *
 * Single plan: Staveto Pro — 14 days free, then €14.99/month.
 * Server billing (getBillingStatus) is source of truth.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
  Platform,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { useNavigation } from "@react-navigation/native";
import {
  getEntitlement,
  purchaseMonthly,
  restorePurchases,
  REVENUECAT_PACKAGE_MONTHLY_NOTRIAL,
  REVENUECAT_PACKAGE_MONTHLY_TRIAL,
} from "../services/billing";
import Purchases from "react-native-purchases";
import { colors, radius, spacing } from "../theme";
import { PRIVACY_URL, TERMS_URL } from "../constants/consent";
import { useI18n } from "../i18n/I18nContext";
import { showToast } from "../helpers/toast";

export function SubscriptionScreen() {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const navigation = useNavigation();
  const billing = user?.billing ?? null;
  const [usage, setUsage] = useState<{ ocrUsed: number; ocrLimit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const loadUsage = async () => {
    try {
      const ent = await getEntitlement();
      setUsage({ ocrUsed: ent.ocrUsed, ocrLimit: ent.ocrLimit });
    } catch {
      setUsage({ ocrUsed: 0, ocrLimit: 0 });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    loadUsage();
  }, [user?.id]);

  // Debug: log RevenueCat offerings on mount (dev only)
  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    (async () => {
      try {
        const offerings = await Purchases.getOfferings();
        if (cancelled) return;
        console.log("[RC] current offering:", offerings.current?.identifier);
        console.log("[RC] all offerings:", Object.keys(offerings.all ?? {}));
        console.log(
          "[RC] packages:",
          offerings.current?.availablePackages?.map((p) => ({
            pkg: p.identifier,
            productId: p.product.identifier,
          }))
        );
        const packages = offerings.current?.availablePackages ?? [];
        if (packages.length === 0) {
          Alert.alert(
            "RevenueCat",
            "No packages available. Likely not installed from Google Play / wrong tester account / wrong track."
          );
        }
      } catch (error: unknown) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[RC] getOfferings error:", msg);
        Alert.alert("RevenueCat", `getOfferings failed: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    await loadUsage();
  };

  const handleActivatePro = async () => {
    setPurchasing(true);
    try {
      const isTrial = billing?.status === "trial";
      const preferredPackageIds = isTrial
        ? [REVENUECAT_PACKAGE_MONTHLY_NOTRIAL, REVENUECAT_PACKAGE_MONTHLY_TRIAL]
        : [REVENUECAT_PACKAGE_MONTHLY_TRIAL, REVENUECAT_PACKAGE_MONTHLY_NOTRIAL];
      const { success } = await purchaseMonthly(preferredPackageIds);
      if (success) {
        showToast(t("paywall.purchaseSuccess"));
        await refreshUser();
      } else {
        Alert.alert(
          t("paywall.purchaseFailed"),
          t("paywall.noProducts", { store: Platform.OS === "ios" ? "App Store Connect" : "Play Console" })
        );
      }
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean };
      if (err?.userCancelled === true) return; // User cancelled – no alert
      Alert.alert(t("paywall.purchaseFailed"), String(e));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    try {
      const { success } = await restorePurchases();
      if (success) {
        showToast(t("paywall.restoreSuccess"));
        await refreshUser();
      } else {
        showToast(t("paywall.restoreNoPurchases"));
      }
    } catch (e) {
      Alert.alert(t("paywall.restoreFailed"), String(e));
    } finally {
      setPurchasing(false);
    }
  };

  if (loading && !billing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isPro = billing?.isPro ?? false;
  const status = billing?.status ?? "expired";
  const statusLabel =
    status === "trial"
      ? t("subscription.statusTrial")
      : status === "active"
        ? t("subscription.statusActive")
        : t("subscription.statusExpired");

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return iso;
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {t("subscription.currentPlan")}
        </Text>
        <View style={styles.currentPlanCard}>
          <View style={styles.currentPlanHeader}>
            <Text style={styles.currentPlanName} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              {t("subscription.planSingle")}
            </Text>
            <Text style={styles.currentPlanPrice} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              €14.99
            </Text>
          </View>
          <Text style={styles.currentPlanPeriod} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            /{t("subscription.planSingleDescription")}
          </Text>
          <View style={[styles.statusBadge, status === "expired" && styles.statusBadgeExpired]}>
            <Text style={[styles.statusBadgeText, status === "expired" && styles.statusBadgeTextExpired]} maxFontSizeMultiplier={1.1} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
          {status === "trial" && (
            <Text style={styles.trialRemaining} maxFontSizeMultiplier={1.2} numberOfLines={2}>
              {t("subscription.trialRemainingDays", { count: String(billing?.remainingTrialDays ?? 0) })}
            </Text>
          )}
          {status === "expired" && (
            <Text style={styles.trialExpiredText} maxFontSizeMultiplier={1.2} numberOfLines={2}>
              {t("subscription.trialExpired")}
            </Text>
          )}
          {status === "active" && billing?.currentPeriodEndAt && (
            <Text style={styles.renewsAt} maxFontSizeMultiplier={1.2} numberOfLines={2}>
              {t("subscription.renewsAt", { date: formatDate(billing.currentPeriodEndAt) })}
            </Text>
          )}
          {!isPro && (
            <TouchableOpacity
              style={[styles.activateButton, purchasing && styles.upgradeButtonDisabled]}
              onPress={handleActivatePro}
              disabled={purchasing}
              accessibilityRole="button"
              accessibilityLabel={t("subscription.activatePro")}
            >
              {purchasing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.activateButtonText} maxFontSizeMultiplier={1.1} numberOfLines={1}>
                  {t("subscription.activatePro")}
                </Text>
              )}
            </TouchableOpacity>
          )}
          {!isPro && (
            <TouchableOpacity
              style={styles.restoreButton}
              onPress={handleRestore}
              disabled={purchasing}
              accessibilityRole="button"
              accessibilityLabel={t("paywall.restorePurchases")}
            >
              <Text style={styles.restoreButtonText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                {t("paywall.restorePurchases")}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {!isPro && (
        <View style={styles.usageSection}>
          <Text style={styles.usageTitle} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("subscription.ocrUsed")}
          </Text>
          <View style={styles.usageItem}>
            <View style={styles.usageBarContainer}>
              <View
                style={[
                  styles.usageBar,
                  {
                    width: `${Math.min(100, ((usage?.ocrUsed ?? 0) / (usage?.ocrLimit || 1)) * 100)}%`,
                    backgroundColor:
                      (usage?.ocrUsed ?? 0) >= (usage?.ocrLimit ?? 0)
                        ? "#FF5722"
                        : colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.usageValue} maxFontSizeMultiplier={1.1} numberOfLines={1}>
              {usage?.ocrUsed ?? 0} / {usage?.ocrLimit ?? 0}
            </Text>
          </View>
        </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} maxFontSizeMultiplier={1.2}>
          {t("subscription.footerText")}
        </Text>
        <View style={styles.legalLinks}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            {t("account.privacyPolicy")}
          </Text>
          <Text style={styles.legalSeparator}> • </Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
            {t("account.termsOfService")}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.md,
  },
  currentPlanCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  currentPlanHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  currentPlanName: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  currentPlanPrice: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.primary,
  },
  currentPlanPeriod: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  statusBadge: {
    backgroundColor: colors.primary + "20",
    padding: spacing.sm,
    borderRadius: radius,
    alignSelf: "flex-start",
  },
  statusBadgeExpired: {
    backgroundColor: "#FF572220",
  },
  statusBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "500",
  },
  statusBadgeTextExpired: {
    color: "#FF5722",
  },
  trialRemaining: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  trialExpiredText: {
    fontSize: 14,
    color: "#FF5722",
    marginTop: spacing.sm,
  },
  renewsAt: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  activateButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginTop: spacing.md,
  },
  activateButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  restoreButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  restoreButtonText: {
    color: colors.primary,
    fontSize: 14,
  },
  usageSection: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  usageTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
  },
  usageItem: {
    marginBottom: spacing.xs,
  },
  usageBarContainer: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: spacing.xs,
  },
  usageBar: {
    height: "100%",
    borderRadius: 4,
  },
  usageValue: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "500",
  },
  upgradeButtonDisabled: {
    opacity: 0.6,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  legalLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  legalLink: {
    fontSize: 12,
    color: colors.primary,
    textDecorationLine: "underline",
  },
  legalSeparator: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
