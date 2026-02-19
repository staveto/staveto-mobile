/**
 * Subscription Management Screen
 *
 * Single plan: 14-day trial then €14.99/month.
 * Shows entitlement status and OCR usage.
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
  Modal,
  TextInput,
  Pressable,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  getUserSubscription,
  redeemPromoCode as redeemPromoCodeService,
  subscribeToSubscription,
  type Subscription,
} from "../services/subscription";
import { getEntitlement, DEFAULT_ENTITLEMENT, type Entitlement } from "../services/billing";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { showToast } from "../helpers/toast";

export function SubscriptionScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigation = useNavigation();
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoRedeeming, setPromoRedeeming] = useState(false);

  const loadData = async () => {
    if (!user?.id) return;
    try {
      const [ent, sub] = await Promise.all([
        getEntitlement(),
        getUserSubscription(user.id),
      ]);
      setEntitlement(ent);
      setSubscription(sub);
    } catch (error) {
      console.error("[SubscriptionScreen] Error loading:", error);
      setEntitlement(DEFAULT_ENTITLEMENT);
      setSubscription(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    loadData();
    const unsubscribe = subscribeToSubscription(user.id, (sub) => {
      setSubscription(sub);
    });
    return () => unsubscribe();
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const getPromoErrorMessage = (code: string): string => {
    switch (code) {
      case "INVALID_CODE":
        return t("subscription.promoInvalidCode");
      case "EXPIRED":
        return t("subscription.promoExpired");
      case "LIMIT_REACHED":
        return t("subscription.promoLimitReached");
      case "ALREADY_REDEEMED":
        return t("subscription.promoAlreadyRedeemed");
      case "UNAUTHENTICATED":
        return t("subscription.promoUnauthenticated");
      default:
        return t("common.error") + ": " + (code || "Unknown error");
    }
  };

  const handleRedeemPromoCode = async () => {
    const code = promoCodeInput.trim();
    if (!code) return;
    setPromoRedeeming(true);
    try {
      const result = await redeemPromoCodeService(code);
      showToast(t("subscription.promoCodeSuccess"));
      setShowPromoModal(false);
      setPromoCodeInput("");
      setSubscription({
        tier: "PRO",
        status: "active",
        currentPeriodEnd: result.currentPeriodEnd,
        source: "promo",
        promoCode: code.toUpperCase(),
      });
      await loadData();
    } catch (error: any) {
      const code = error?.message || error?.details || "";
      Alert.alert(t("common.error"), getPromoErrorMessage(code));
    } finally {
      setPromoRedeeming(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const statusLabel =
    entitlement?.status === "trial"
      ? t("subscription.statusTrial")
      : entitlement?.status === "active"
        ? t("subscription.statusActive")
        : t("subscription.statusExpired");

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("subscription.currentPlan")}</Text>
        <TouchableOpacity
          style={styles.currentPlanCard}
          onPress={() => {
            if (!entitlement?.entitlement) {
              (navigation as any).navigate("Paywall");
            }
          }}
          activeOpacity={entitlement?.entitlement ? 1 : 0.7}
          disabled={!!entitlement?.entitlement}
        >
          <View style={styles.currentPlanHeader}>
            <Text style={styles.currentPlanName}>{t("subscription.planSingle")}</Text>
            <Text style={styles.currentPlanPrice}>14.99 €</Text>
          </View>
          <Text style={styles.currentPlanPeriod}>/{t("subscription.planSingleDescription")}</Text>
          <View style={[styles.statusBadge, !entitlement?.entitlement && styles.statusBadgeExpired]}>
            <Text style={[styles.statusBadgeText, !entitlement?.entitlement && styles.statusBadgeTextExpired]}>
              {statusLabel}
            </Text>
          </View>
          {!entitlement?.entitlement && (
            <View style={styles.upgradeHint}>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              <Text style={styles.upgradeHintText}>{t("paywall.selectPlan")}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.usageSection}>
          <Text style={styles.usageTitle}>{t("subscription.ocrUsed")}</Text>
          <View style={styles.usageItem}>
            <View style={styles.usageBarContainer}>
              <View
                style={[
                  styles.usageBar,
                  {
                    width: `${Math.min(100, ((entitlement?.ocrUsed ?? 0) / (entitlement?.ocrLimit || 1)) * 100)}%`,
                    backgroundColor:
                      (entitlement?.ocrUsed ?? 0) >= (entitlement?.ocrLimit ?? 0)
                        ? "#FF5722"
                        : colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.usageValue}>
              {entitlement?.ocrUsed ?? 0} / {entitlement?.ocrLimit ?? 0}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.promoButton} onPress={() => setShowPromoModal(true)}>
          <Ionicons name="pricetag-outline" size={20} color={colors.primary} />
          <Text style={styles.promoButtonText}>{t("subscription.havePromoCode")}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t("subscription.footerText")}</Text>
      </View>

      <Modal visible={showPromoModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => !promoRedeeming && setShowPromoModal(false)}>
          <Pressable style={styles.promoModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.promoModalTitle}>{t("subscription.havePromoCode")}</Text>
            <TextInput
              style={styles.promoInput}
              placeholder={t("subscription.promoCodePlaceholder")}
              placeholderTextColor={colors.textMuted}
              value={promoCodeInput}
              onChangeText={setPromoCodeInput}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!promoRedeeming}
            />
            <View style={styles.promoModalActions}>
              <TouchableOpacity
                style={styles.promoCancelButton}
                onPress={() => !promoRedeeming && setShowPromoModal(false)}
                disabled={promoRedeeming}
              >
                <Text style={styles.promoCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.promoApplyButton, promoRedeeming && styles.upgradeButtonDisabled]}
                onPress={handleRedeemPromoCode}
                disabled={!promoCodeInput.trim() || promoRedeeming}
              >
                {promoRedeeming ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.promoApplyText}>{t("subscription.promoCodeApply")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  upgradeHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.sm,
  },
  upgradeHintText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "500",
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
  promoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  promoButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  promoModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 340,
  },
  promoModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
  },
  promoInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  promoModalActions: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "flex-end",
  },
  promoCancelButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  promoCancelText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  promoApplyButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minWidth: 80,
    alignItems: "center",
  },
  promoApplyText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
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
  },
});
