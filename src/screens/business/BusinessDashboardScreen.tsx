import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useI18n } from "../../i18n/I18nContext";
import { getBusinessOrder, type BusinessOrderDoc } from "../../services/organizations";
import { listMembers, type MembershipDoc } from "../../services/businessMembers";
import { createBusinessCheckoutSession } from "../../services/businessPayments";
import { colors } from "../../theme";

function toMillis(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const maybeTimestamp = raw as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const parsed = maybeTimestamp.toDate().getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function formatDate(raw: unknown): string | null {
  const ms = toMillis(raw);
  if (ms === null) return null;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return null;
  }
}

function getDaysUntil(raw: unknown): number | null {
  const ms = toMillis(raw);
  if (ms === null) return null;
  const diff = ms - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getErrorDetails(error: unknown): { code: string; message: string } {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  return { code, message };
}

export function BusinessDashboardScreen() {
  const { activeOrganization, activeMembership } = useActiveOrg();
  const { t } = useI18n();
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const [activeOrder, setActiveOrder] = useState<BusinessOrderDoc | null>(null);
  const [orgMembers, setOrgMembers] = useState<MembershipDoc[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersReadBlocked, setMembersReadBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const orderId = activeOrganization?.activeBusinessOrderId ?? null;
    if (!orderId) {
      setActiveOrder(null);
      return;
    }
    getBusinessOrder(orderId)
      .then((order) => {
        if (!cancelled) setActiveOrder(order);
      })
      .catch(() => {
        if (!cancelled) setActiveOrder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization?.activeBusinessOrderId]);

  useEffect(() => {
    let cancelled = false;
    const orgId = activeOrganization?.id;
    if (!orgId) {
      setOrgMembers([]);
      setMembersReadBlocked(false);
      return;
    }
    setMembersLoading(true);
    setMembersReadBlocked(false);
    listMembers(orgId)
      .then((rows) => {
        if (cancelled) return;
        setOrgMembers(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[BusinessDashboard] listMembers failed", { orgId, error });
        setOrgMembers([]);
        setMembersReadBlocked(true);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization?.id]);

  const planLabel = useMemo(() => {
    const planCode = activeOrganization?.planCode ?? activeOrder?.planCode ?? activeOrder?.priceSnapshot?.planCode;
    if (!planCode) return "—";
    if (planCode === "business_starter") return t("business.planSelection.starterTitle");
    if (planCode === "business_team") return t("business.planSelection.teamTitle");
    if (planCode === "business_company") return t("business.planSelection.companyTitle");
    if (planCode === "business_enterprise") return t("business.planSelection.enterpriseTitle");
    return "Business";
  }, [activeOrder?.planCode, activeOrder?.priceSnapshot?.planCode, activeOrganization?.planCode, t]);

  const seats = activeOrganization?.requestedSeats ?? activeOrder?.requestedSeats ?? activeOrganization?.seatsLimit ?? 0;
  const trialDaysLeft = getDaysUntil(activeOrganization?.trialEndsAt);
  const hasValidTrial = trialDaysLeft !== null && trialDaysLeft >= 0;
  const isPendingPayment = activeOrganization?.status === "pending_payment";
  const isTrialing = activeOrganization?.status === "trialing";
  const isLegacyPending = isPendingPayment && !hasValidTrial;
  const billingPeriodRaw =
    activeOrganization?.billingPeriod ??
    activeOrder?.billingPeriod ??
    activeOrder?.priceSnapshot?.billingPeriod ??
    "manual";
  const billingPeriodLabel =
    billingPeriodRaw === "yearly"
      ? t("business.planSelection.billingYearly")
      : billingPeriodRaw === "monthly"
      ? t("business.planSelection.billingMonthly")
      : t("business.dashboard.billingManual");
  const amountGross =
    activeOrder?.paymentInstructions?.amountGross ??
    activeOrder?.priceSnapshot?.totalGross ??
    null;
  const seatsLimit = activeOrganization?.seatsLimit || activeOrganization?.requestedSeats || 0;
  const memberCandidates = orgMembers.filter((member) => {
    const normalized = member.status.toLowerCase();
    return normalized === "active" || normalized === "invited" || normalized === "pending";
  });
  const activeMembers = memberCandidates.filter((member) => member.status === "active");
  const pendingInvites = memberCandidates.filter((member) => {
    const normalized = member.status.toLowerCase();
    return normalized === "invited" || normalized === "pending";
  });
  const usedSeats = activeMembers.length;
  const freeSeats = Math.max(seatsLimit - usedSeats, 0);
  const previewMembers = memberCandidates.slice(0, 5);
  const canManageTeam =
    activeMembership?.role === "owner" ||
    activeMembership?.role === "admin" ||
    activeMembership?.role === "manager";
  const canChangePlan = activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const orgId = activeOrganization?.id ?? null;
  const orderId = activeOrder?.id ?? activeOrganization?.activeBusinessOrderId ?? null;

  const openChangePlan = () => {
    if (!orgId || !orderId) {
      Alert.alert(t("business.dashboard.paymentStartFailedTitle"), t("business.dashboard.selectPlanFirstBody"));
      return;
    }
    nav.navigate("BusinessPlanSelection", {
      mode: "changePlan",
      orgId,
      orderId,
      currentPlanCode:
        (activeOrder?.planCode as string | undefined) ||
        (activeOrder?.priceSnapshot?.planCode as string | undefined) ||
        (activeOrganization?.planCode as string | undefined),
      currentBillingPeriod:
        (activeOrder?.billingPeriod as string | undefined) ||
        (activeOrder?.priceSnapshot?.billingPeriod as string | undefined) ||
        (activeOrganization?.billingPeriod as string | undefined),
    });
  };

  const onPayOnlinePress = async () => {
    if (!orgId || !orderId) {
      Alert.alert(t("business.dashboard.paymentStartFailedTitle"), t("business.dashboard.selectPlanFirstBody"));
      return;
    }
    try {
      Alert.alert(t("business.dashboard.payOnlineTitle"), t("business.dashboard.openingStripeCheckout"));
      const result = await createBusinessCheckoutSession({ orgId, orderId });
      await Linking.openURL(result.checkoutUrl);
    } catch (error) {
      const details = getErrorDetails(error);
      const lowerCode = details.code.toLowerCase();
      const lowerMessage = details.message.toLowerCase();
      const needsPlanSelection =
        lowerCode.includes("failed-precondition") &&
        (lowerMessage.includes("najprv vyberte konkr") || lowerMessage.includes("select"));
      if (needsPlanSelection) {
        Alert.alert(
          t("business.dashboard.selectPlanFirstTitle"),
          t("business.dashboard.selectPlanFirstBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("business.dashboard.changePlanCta"), onPress: openChangePlan },
          ]
        );
        return;
      }
      Alert.alert(
        t("business.dashboard.paymentStartFailedTitle"),
        `${t("business.dashboard.paymentStartFailedBody")}\n${details.code}: ${details.message}`
      );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.dashboard.title")}</Text>
      <Text style={styles.subtitle}>{t("business.dashboard.subtitle")}</Text>
      <Text style={styles.text}>{t("business.dashboard.placeholderBody")}</Text>
      {activeOrganization?.name ? (
        <Text style={styles.orgName}>
          {t("business.pending.company")}: {activeOrganization.name}
        </Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("business.dashboard.teamLicenses.title")}</Text>
        <Text style={styles.cardBody}>{t("business.dashboard.teamLicenses.used", { used: String(usedSeats), limit: String(seatsLimit) })}</Text>
        <Text style={styles.cardBody}>{t("business.dashboard.teamLicenses.free", { count: String(freeSeats) })}</Text>
        <Text style={styles.cardBody}>{t("business.dashboard.teamLicenses.members", { count: String(memberCandidates.length) })}</Text>
        {pendingInvites.length > 0 ? (
          <Text style={styles.pendingInfoText}>
            {t("business.dashboard.teamLicenses.pendingInvites", { count: String(pendingInvites.length) })}
          </Text>
        ) : null}
        {seatsLimit <= 0 ? (
          <Text style={styles.warningText}>{t("business.dashboard.teamLicenses.limitNotSet")}</Text>
        ) : null}
        {membersLoading ? (
          <Text style={styles.emptyText}>{t("loading.text")}</Text>
        ) : membersReadBlocked ? (
          <Text style={styles.warningText}>{t("business.dashboard.teamLicenses.membersReadBlocked")}</Text>
        ) : previewMembers.length === 0 ? (
          <Text style={styles.emptyText}>{t("business.dashboard.teamLicenses.noMembers")}</Text>
        ) : (
          <View style={styles.membersList}>
            {previewMembers.map((member) => (
              <MemberRow key={member.id} member={member} t={t} />
            ))}
          </View>
        )}
        <View style={styles.teamActions}>
          <TouchableOpacity
            style={[styles.secondaryButton, !canManageTeam && styles.buttonDisabled]}
            disabled={!canManageTeam}
            onPress={() => {
              if (freeSeats <= 0) {
                Alert.alert(
                  t("business.dashboard.teamLicenses.limitReachedTitle"),
                  t("business.dashboard.teamLicenses.limitReachedMessage")
                );
                return;
              }
              Alert.alert(
                t("business.dashboard.teamLicenses.inviteMember"),
                t("business.dashboard.teamLicenses.manageComingSoon")
              );
            }}
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.teamLicenses.inviteMember")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, !canManageTeam && styles.buttonDisabled]}
            disabled={!canManageTeam}
            onPress={() =>
              Alert.alert(
                t("business.dashboard.teamLicenses.manageTeam"),
                t("business.dashboard.teamLicenses.manageComingSoon")
              )
            }
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.teamLicenses.manageTeam")}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.messagesCard}>
          <Text style={styles.messagesTitle}>{t("business.dashboard.actions.messages.title")}</Text>
          <Text style={styles.messagesBody}>{t("business.dashboard.actions.messages.body")}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => nav.navigate("BusinessChatList")}>
            <Text style={styles.secondaryButtonText}>{t("business.chat.open")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {(isTrialing || isPendingPayment) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {isLegacyPending
              ? t("business.dashboard.pendingLegacyBannerTitle")
              : t("business.dashboard.trialCardTitle")}
          </Text>
          <Text style={styles.cardBody}>
            {isLegacyPending
              ? t("business.dashboard.pendingLegacyBannerBody")
              : t("business.dashboard.trialCardSubtitle")}
          </Text>

          <InfoRow
            label={t("business.pending.company")}
            value={activeOrganization?.name ?? t("business.dashboard.companyFallback")}
          />
          <InfoRow label={t("business.pending.status")} value={activeOrganization?.status ?? "—"} />
          <InfoRow label={t("business.dashboard.planLabel", { plan: planLabel })} value={planLabel} />
          <InfoRow
            label={t("business.dashboard.seatsLabel", {
              used: String(usedSeats),
              limit: String(seatsLimit > 0 ? seatsLimit : seats),
            })}
            value={seats > 0 ? String(seats) : "—"}
          />
          <InfoRow
            label={t("business.pending.billingPeriod")}
            value={billingPeriodLabel}
          />
          {amountGross !== null ? (
            <InfoRow
              label={t("business.pending.amount")}
              value={t("business.dashboard.amountLabel", { amount: String(amountGross) })}
            />
          ) : null}
          {activeOrder?.orderNumber ? (
            <InfoRow label={t("business.pending.orderNumber")} value={activeOrder.orderNumber} />
          ) : null}
          {activeOrder?.variableSymbol ? (
            <InfoRow label={t("business.pending.variableSymbol")} value={activeOrder.variableSymbol} />
          ) : null}
          {hasValidTrial ? (
            <InfoRow
              label={t("business.dashboard.trialEndsAtLabel", {
                date: formatDate(activeOrganization?.trialEndsAt) ?? "—",
              })}
              value={
                t("business.dashboard.trialEndsInDays", { days: String(trialDaysLeft ?? 0) })
              }
            />
          ) : null}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onPayOnlinePress}
          >
            <Text style={styles.primaryButtonText}>{t("business.dashboard.payOnlineCta")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, !canChangePlan && styles.buttonDisabled]}
            disabled={!canChangePlan}
            onPress={openChangePlan}
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.changePlanCta")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() =>
              nav.navigate("BusinessOrderPending", {
                companyName: activeOrganization?.name,
                orderNumber: activeOrder?.orderNumber,
                requestedSeats: seats,
                status: activeOrganization?.status,
                variableSymbol: activeOrder?.variableSymbol,
                paymentReference: activeOrder?.paymentReference,
                billingEmail: activeOrganization?.billingEmail,
              })
            }
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.bankTransferCta")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tertiaryButton}
            onPress={() => Alert.alert(t("business.dashboard.contactSupportTitle"), t("business.dashboard.contactSupportBody"))}
          >
            <Text style={styles.tertiaryButtonText}>{t("business.dashboard.contactSupportCta")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function getMemberDisplay(member: MembershipDoc): string {
  const displayName = (member.displayName ?? "").trim();
  if (displayName) return displayName;
  const email = (member.email ?? member.emailLower ?? "").trim();
  if (email) return email;
  return member.userId || "—";
}

function getInitials(source: string): string {
  const cleaned = source.trim();
  if (!cleaned) return "?";
  const chunks = cleaned
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "");
  const combined = chunks.join("");
  return combined || cleaned.slice(0, 1).toUpperCase();
}

function MemberRow({
  member,
  t,
}: {
  member: MembershipDoc;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const display = getMemberDisplay(member);
  const statusKey = member.status === "active" ? "business.dashboard.teamLicenses.statusActive" : "business.dashboard.teamLicenses.statusPending";
  const roleKey = `business.dashboard.teamLicenses.role.${member.role}`;
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{getInitials(display)}</Text>
      </View>
      <View style={styles.memberMeta}>
        <Text style={styles.memberName} numberOfLines={1}>
          {display}
        </Text>
        <View style={styles.badgeRow}>
          <Text style={styles.roleBadge}>{t(roleKey)}</Text>
          {member.status !== "active" ? <Text style={styles.statusBadge}>{t(statusKey)}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    paddingBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    textAlign: "left",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    textAlign: "left",
    marginBottom: 14,
  },
  text: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "left",
    lineHeight: 20,
  },
  orgName: {
    marginTop: 16,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "left",
  },
  card: {
    marginTop: 16,
    width: "100%",
    maxWidth: 460,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.card,
    padding: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 6,
  },
  pendingInfoText: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  warningText: {
    marginTop: 8,
    fontSize: 13,
    color: colors.error,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
  },
  membersList: {
    marginTop: 10,
    gap: 8,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  memberAvatarText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  memberMeta: {
    flex: 1,
  },
  memberName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  badgeRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  roleBadge: {
    fontSize: 11,
    color: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadge: {
    fontSize: 11,
    color: colors.textMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  teamActions: {
    marginTop: 10,
    gap: 8,
  },
  messagesCard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  messagesTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  messagesBody: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  row: {
    marginBottom: 8,
  },
  rowLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "600",
  },
  primaryButton: {
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 15,
  },
  tertiaryButton: {
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  tertiaryButtonText: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 13,
  },
});

