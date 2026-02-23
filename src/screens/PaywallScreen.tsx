/**
 * Paywall Screen – "Unlock Premium" style
 * Shows benefits, pricing, CTA to purchase via RevenueCat.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { getEntitlement, getOfferings, purchaseMonthly, restorePurchases } from "../services/billing";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";

const BENEFITS = [
  { icon: "folder-open-outline" as const, key: "paywall.benefit1" },
  { icon: "checkmark-done-outline" as const, key: "paywall.benefit2" },
  { icon: "receipt-outline" as const, key: "paywall.benefit3" },
  { icon: "document-text-outline" as const, key: "paywall.benefit4" },
];

export function PaywallScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { goBack } = navigation;
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasOfferings, setHasOfferings] = useState(false);
  const [isEntitled, setIsEntitled] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ent, offerings] = await Promise.all([getEntitlement(), getOfferings()]);
        if (cancelled) return;
        setIsEntitled(!!ent?.entitlement);
        const current = offerings?.current;
        const pkgCount = current?.availablePackages?.length ?? 0;
        setHasOfferings(pkgCount > 0);
        if (__DEV__) {
          const info = [
            `offerings.current: ${current?.identifier ?? "null"}`,
            `availablePackages: ${pkgCount}`,
            `entitlement: ${ent?.entitlement ? "active" : "none"}`,
          ].join(Platform.OS === "ios" ? "\n" : " | ");
          setDebugInfo(info);
          console.log("[PaywallScreen]", info);
        }
      } catch (e) {
        if (__DEV__) console.error("[PaywallScreen] load error:", e);
        setHasOfferings(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSelectPlan = async () => {
    setPurchasing(true);
    try {
      const { success } = await purchaseMonthly();
      if (success) {
        showToast(t("paywall.purchaseSuccess"));
        goBack();
      } else {
        showToast(t("paywall.purchaseFailed"));
      }
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean; code?: number };
      if (err?.userCancelled === true) {
        return; // User closed purchase sheet – no toast
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (__DEV__) console.error("[PaywallScreen] purchase error:", e);
      showToast(t("paywall.purchaseFailed") + (msg ? `: ${msg}` : ""));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const { success } = await restorePurchases();
      if (success) {
        showToast(t("paywall.restoreSuccess"));
        setIsEntitled(true);
        goBack();
      } else {
        showToast(t("paywall.restoreNoPurchases"));
      }
    } catch (e: unknown) {
      if (__DEV__) console.error("[PaywallScreen] restore error:", e);
      showToast(t("paywall.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isEntitled) {
    return (
      <View style={styles.container}>
        <View style={styles.entitledCard}>
          <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
          <Text style={styles.entitledTitle}>{t("paywall.alreadySubscribed")}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => goBack()}>
            <Text style={styles.backButtonText}>{t("common.back")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("paywall.title")}</Text>
        <Text style={styles.subtitle}>{t("paywall.subtitle")}</Text>
      </View>

      <View style={styles.benefits}>
        {BENEFITS.map((b, i) => (
          <View key={i} style={styles.benefitRow}>
            <Ionicons name={b.icon} size={24} color={colors.primary} />
            <Text style={styles.benefitText}>{t(b.key)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.pricingCard}>
        <Text style={styles.planName}>{t("subscription.planSingle")}</Text>
        <Text style={styles.price}>14.99 €</Text>
        <Text style={styles.period}>/{t("subscription.planSingleDescription")}</Text>
      </View>

      {!hasOfferings && (
        <View style={styles.noProducts}>
          <Ionicons name="warning-outline" size={32} color="#FF5722" />
          <Text style={styles.noProductsText}>{t("paywall.noProducts")}</Text>
        </View>
      )}

      {hasOfferings && (
        <TouchableOpacity
          style={[styles.ctaButton, (purchasing || restoring) && styles.ctaDisabled]}
          onPress={handleSelectPlan}
          disabled={purchasing || restoring}
        >
          {purchasing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.ctaText}>{t("paywall.selectPlan")}</Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.restoreLink}
        onPress={handleRestore}
        disabled={purchasing || restoring}
      >
        {restoring ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={styles.restoreText}>{t("paywall.restorePurchases")}</Text>
        )}
      </TouchableOpacity>

      {__DEV__ && debugInfo ? (
        <View style={styles.debug}>
          <Text style={styles.debugText}>{debugInfo}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.85)",
  },
  benefits: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  benefitText: {
    flex: 1,
    fontSize: 16,
    color: colors.textOnDark,
  },
  pricingCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  planName: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
  },
  price: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.primary,
  },
  period: {
    fontSize: 14,
    color: colors.textMuted,
  },
  noProducts: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#FF572220",
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noProductsText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  ctaButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  restoreLink: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  restoreText: {
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: "underline",
  },
  entitledCard: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  entitledTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.textOnDark,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  backButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius,
  },
  backButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  debug: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: radius,
  },
  debugText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.8)",
  },
});
