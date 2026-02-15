/**
 * Subscription Management Screen
 * 
 * Shows current subscription tier, limits, and allows upgrade via Stripe Checkout.
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
  Linking,
  RefreshControl,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import {
  getUserSubscription,
  createCheckoutSession,
  createBillingPortalSession,
  getSubscriptionLimits,
  subscribeToSubscription,
  type Subscription,
  type SubscriptionTier,
} from "../services/subscription";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";

// Stripe Price IDs - REPLACE WITH YOUR ACTUAL STRIPE PRICE IDs
const STRIPE_PRICE_IDS = {
  BASIC_MONTHLY: "price_basic_monthly", // TODO: Replace with actual Stripe Price ID
  BASIC_YEARLY: "price_basic_yearly", // TODO: Replace with actual Stripe Price ID
  PRO_MONTHLY: "price_pro_monthly", // TODO: Replace with actual Stripe Price ID
  PRO_YEARLY: "price_pro_yearly", // TODO: Replace with actual Stripe Price ID
};

const SUBSCRIPTION_PLANS = [
  {
    tier: "FREE" as SubscriptionTier,
    name: "Bezplatná verzia",
    price: "0 €",
    period: "navždy",
    features: ["1 projekt", "10 úloh na projekt", "5 výdavkov mesačne", "10 MB úložného priestoru"],
    priceId: null,
  },
  {
    tier: "BASIC" as SubscriptionTier,
    name: "Základné predplatné",
    price: "9.99 €",
    period: "mesačne",
    features: ["5 projektov", "50 úloh na projekt", "50 výdavkov mesačne", "100 MB úložného priestoru", "Export dát"],
    priceId: STRIPE_PRICE_IDS.BASIC_MONTHLY,
  },
  {
    tier: "PRO" as SubscriptionTier,
    name: "Profesionálne predplatné",
    price: "29.99 €",
    period: "mesačne",
    features: [
      "20 projektov",
      "Neobmedzené úlohy",
      "Neobmedzené výdavky",
      "1 GB úložného priestoru",
      "Pokročilé reporty",
      "Prioritná podpora",
    ],
    priceId: STRIPE_PRICE_IDS.PRO_MONTHLY,
  },
];

export function SubscriptionScreen() {
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upgrading, setUpgrading] = useState<string | null>(null); // priceId being upgraded to
  
  // Usage stats
  const [projectCount, setProjectCount] = useState(0);
  const [expenseCount, setExpenseCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    
    loadSubscription();
    loadUsageStats();
    
    // Subscribe to real-time subscription updates
    const unsubscribe = subscribeToSubscription(user.id, (sub) => {
      setSubscription(sub);
    });
    
    return () => unsubscribe();
  }, [user?.id, orgId]);

  const loadSubscription = async () => {
    if (!user?.id) return;
    try {
      const sub = await getUserSubscription(user.id);
      setSubscription(sub);
    } catch (error) {
      console.error("[SubscriptionScreen] Error loading subscription:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadUsageStats = async () => {
    if (!orgId) return;
    try {
      // Count projects
      const projects = await projectsService.listMyProjects(orgId);
      setProjectCount(projects.length);
      
      // Count expenses this month
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      let expenseCountTotal = 0;
      
      for (const project of projects) {
        try {
          const expenses = await expensesService.listExpensesByProject(project.id);
          const monthlyExpenses = expenses.filter((exp) => {
            if (!exp.date || exp.status !== "READY") return false;
            const expenseDate = new Date(exp.date);
            return expenseDate >= firstDayOfMonth;
          });
          expenseCountTotal += monthlyExpenses.length;
        } catch (error) {
          // Skip projects with expense loading errors
        }
      }
      
      setExpenseCount(expenseCountTotal);
    } catch (error) {
      console.error("[SubscriptionScreen] Error loading usage stats:", error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSubscription();
    await loadUsageStats();
  };

  const handleUpgrade = async (priceId: string) => {
    if (!priceId) {
      Alert.alert(t("common.error"), t("subscription.cannotStartPayment") || "Nie je možné spustiť platobný proces.");
      return;
    }
    
    setUpgrading(priceId);
    try {
      const { url } = await createCheckoutSession(priceId);
      
      // Open Stripe Checkout in browser/webview
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        Alert.alert(
          t("subscription.paymentTitle"),
          t("subscription.paymentInfo")
        );
      } else {
        Alert.alert(t("common.error"), t("subscription.failedToOpenPaymentPage") || "Nepodarilo sa otvoriť platobnú stránku.");
      }
    } catch (error: any) {
      console.error("[SubscriptionScreen] Error creating checkout:", error);
      Alert.alert(t("common.error"), error.message || t("subscription.failedToStartPayment") || "Nepodarilo sa spustiť platobný proces.");
    } finally {
      setUpgrading(null);
    }
  };

  const handleManageBilling = async () => {
    try {
      const { url } = await createBillingPortalSession();
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t("common.error"), t("subscription.failedToOpenManager") || "Nepodarilo sa otvoriť správcu predplatného.");
      }
    } catch (error: any) {
      console.error("[SubscriptionScreen] Error creating billing portal:", error);
      Alert.alert(t("common.error"), error.message || t("subscription.failedToOpenManager") || "Nepodarilo sa otvoriť správcu predplatného.");
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const currentTier = subscription?.tier || "FREE";
  const currentPlan = SUBSCRIPTION_PLANS.find((p) => p.tier === currentTier)!;
  const limits = getSubscriptionLimits(currentTier);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Current Plan */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("subscription.currentPlan") || 'Aktuálne predplatné'}</Text>
        <View style={styles.currentPlanCard}>
          <View style={styles.currentPlanHeader}>
            <Text style={styles.currentPlanName}>{currentPlan.name}</Text>
            <Text style={styles.currentPlanPrice}>{currentPlan.price}</Text>
          </View>
          <Text style={styles.currentPlanPeriod}>/{currentPlan.period}</Text>
          {subscription?.status === "past_due" && (
            <View style={styles.warningBadge}>
              <Ionicons name="warning" size={16} color="#FF9800" />
              <Text style={styles.warningText}>{t("subscription.paymentFailed") || 'Platba neúspešná'}</Text>
            </View>
          )}
          {subscription?.status === "trialing" && (
            <View style={styles.trialBadge}>
              <Text style={styles.trialText}>{t("subscription.trialPeriod") || 'Skúšobné obdobie'}</Text>
            </View>
          )}
        </View>

        {/* Usage Stats */}
        <View style={styles.usageSection}>
          <Text style={styles.usageTitle}>{t("subscription.usageLimits") || 'Využitie limitov'}</Text>
          
          <View style={styles.usageItem}>
            <Text style={styles.usageLabel}>{t("subscription.projects")}</Text>
            <View style={styles.usageBarContainer}>
              <View
                style={[
                  styles.usageBar,
                  {
                    width: `${Math.min(100, (projectCount / (limits.maxProjects === -1 ? 1 : limits.maxProjects)) * 100)}%`,
                    backgroundColor: projectCount >= limits.maxProjects && limits.maxProjects !== -1 ? "#FF5722" : colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.usageValue}>
              {projectCount} / {limits.maxProjects === -1 ? "∞" : limits.maxProjects}
            </Text>
          </View>

          <View style={styles.usageItem}>
            <Text style={styles.usageLabel}>{t("subscription.expensesThisMonth")}</Text>
            <View style={styles.usageBarContainer}>
              <View
                style={[
                  styles.usageBar,
                  {
                    width: `${Math.min(100, (expenseCount / (limits.maxExpensesPerMonth === -1 ? 1 : limits.maxExpensesPerMonth)) * 100)}%`,
                    backgroundColor: expenseCount >= limits.maxExpensesPerMonth && limits.maxExpensesPerMonth !== -1 ? "#FF5722" : colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.usageValue}>
              {expenseCount} / {limits.maxExpensesPerMonth === -1 ? "∞" : limits.maxExpensesPerMonth}
            </Text>
          </View>
        </View>

        {/* Manage Billing */}
        {subscription?.status === "active" && subscription.tier !== "FREE" && (
          <TouchableOpacity style={styles.manageButton} onPress={handleManageBilling}>
            <Ionicons name="card-outline" size={20} color={colors.primary} />
            <Text style={styles.manageButtonText}>{t("subscription.managePayment") || 'Spravovať platbu a faktúry'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Available Plans */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("subscription.availablePlans") || 'Dostupné plány'}</Text>
        {SUBSCRIPTION_PLANS.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          const isUpgrading = upgrading === plan.priceId;
          
          return (
            <View key={plan.tier} style={[styles.planCard, isCurrent && styles.planCardCurrent]}>
              <View style={styles.planHeader}>
                <Text style={styles.planName}>{plan.name}</Text>
                <View style={styles.planPriceContainer}>
                  <Text style={styles.planPrice}>{plan.price}</Text>
                  <Text style={styles.planPeriod}>/{plan.period}</Text>
                </View>
              </View>
              
              <View style={styles.planFeatures}>
                {plan.features.map((feature, idx) => (
                  <View key={idx} style={styles.planFeature}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                    <Text style={styles.planFeatureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {isCurrent ? (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>{t("subscription.currentPlanBadge") || 'Aktuálny plán'}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.upgradeButton, isUpgrading && styles.upgradeButtonDisabled]}
                  onPress={() => plan.priceId && handleUpgrade(plan.priceId)}
                  disabled={!plan.priceId || isUpgrading}
                >
                  {isUpgrading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.upgradeButtonText}>
                        {plan.tier === "FREE" ? t("subscription.switchTo") || "Prepnut sa na" : t("subscription.upgradeTo") || "Upgrade na"} {plan.name}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t("subscription.footerText")}
        </Text>
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
  },
  warningBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    padding: spacing.sm,
    borderRadius: radius,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  warningText: {
    color: "#FF9800",
    fontSize: 12,
    fontWeight: "500",
  },
  trialBadge: {
    backgroundColor: colors.primary + "20",
    padding: spacing.sm,
    borderRadius: radius,
    marginTop: spacing.sm,
  },
  trialText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
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
    marginBottom: spacing.md,
  },
  usageLabel: {
    fontSize: 12,
    color: colors.textMuted,
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
  manageButton: {
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
  manageButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "500",
  },
  planCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  planCardCurrent: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  planName: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  planPriceContainer: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  planPrice: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
  },
  planPeriod: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  planFeatures: {
    marginBottom: spacing.md,
  },
  planFeature: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  planFeatureText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  currentBadge: {
    backgroundColor: colors.primary + "20",
    padding: spacing.sm,
    borderRadius: radius,
    alignItems: "center",
  },
  currentBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "500",
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    alignItems: "center",
  },
  upgradeButtonDisabled: {
    opacity: 0.6,
  },
  upgradeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
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
