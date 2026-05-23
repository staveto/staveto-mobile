import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useI18n } from "../../i18n/I18nContext";
import { getAuth } from "../../firebase";
import { getBusinessOrder, type BusinessOrderDoc } from "../../services/organizations";
import { listMembers, type MembershipDoc } from "../../services/businessMembers";
import { createBusinessCheckoutSession } from "../../services/businessPayments";
import {
  createBusinessInviteCode,
  formatCreateBusinessInviteError,
  type BusinessInviteRole,
  type CreateBusinessInviteCodeResult,
} from "../../services/businessInvites";
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
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<BusinessInviteRole>("worker");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<CreateBusinessInviteCodeResult | null>(null);
  const [showBusinessInfo, setShowBusinessInfo] = useState(false);
  const authUser = getAuth()?.currentUser ?? null;

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

  const orgRequestedSeats =
    (activeOrganization as { requestedSeats?: number } | null)?.requestedSeats ?? null;
  const seats = orgRequestedSeats ?? activeOrder?.requestedSeats ?? activeOrganization?.seatsLimit ?? 0;
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
  const seatsLimit = activeOrganization?.seatsLimit || orgRequestedSeats || 0;
  const memberCandidates = orgMembers.filter((member) => {
    const normalized = member.status.toLowerCase();
    return normalized === "active" || normalized === "invited" || normalized === "pending";
  });
  const activeMembers = memberCandidates.filter((member) => member.status === "active");
  const pendingInvites = memberCandidates.filter((member) => {
    const normalized = member.status.toLowerCase();
    return normalized === "invited" || normalized === "pending";
  });
  const usedSeats = activeOrganization?.seatsUsed ?? activeMembers.length;
  const freeSeats = Math.max(seatsLimit - usedSeats, 0);
  const previewMembers = memberCandidates.slice(0, 5);
  const companyName =
    activeOrganization?.name ||
    (activeOrganization as { companyName?: string } | null)?.companyName ||
    t("business.dashboard.companyFallback");
  const statusBadgeLabel = isPendingPayment
    ? t("business.dashboard.status.paymentDue")
    : isTrialing
    ? t("business.dashboard.status.trialing")
    : t("business.dashboard.status.active");
  const statusBadgeStyle = isPendingPayment
    ? styles.badgeWarning
    : isTrialing
    ? styles.badgeTrial
    : styles.badgeSuccess;
  const statusLabel = statusBadgeLabel;
  const trialEndsLabel = formatDate(activeOrganization?.trialEndsAt);
  const amountLabel =
    amountGross !== null ? t("business.dashboard.amountLabel", { amount: String(amountGross) }) : null;
  const canManageTeam =
    activeMembership?.role === "owner" ||
    activeMembership?.role === "admin" ||
    activeMembership?.role === "manager";
  const canChangePlan = activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const orgId = activeOrganization?.id ?? null;
  const orderId = activeOrder?.id ?? activeOrganization?.activeBusinessOrderId ?? null;

  const openInviteMemberModal = () => {
    if (freeSeats <= 0) {
      Alert.alert(t("business.invites.error.seatsExceeded"), t("business.invites.error.seatsExceeded"));
      return;
    }
    setInviteResult(null);
    setInviteRole("worker");
    setInviteEmail("");
    setShowInviteModal(true);
  };

  const onGenerateInviteCode = async () => {
    if (!orgId) {
      Alert.alert(t("common.error"), t("business.dashboard.companyFallback"));
      return;
    }
    setInviteBusy(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const result = await createBusinessInviteCode({
        orgId,
        role: inviteRole,
        emailLower: normalizedEmail || undefined,
        requiresApproval: normalizedEmail ? false : true,
      });
      setInviteResult(result);
    } catch (error) {
      Alert.alert(
        t("common.error"),
        formatCreateBusinessInviteError(error, (key, params) =>
          t(key, params as Record<string, string> | undefined)
        )
      );
    } finally {
      setInviteBusy(false);
    }
  };

  const onCopyInviteCode = async () => {
    if (!inviteResult?.code) return;
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(inviteResult.code);
      Alert.alert(t("business.invites.copied"));
    } catch {
      Alert.alert(t("business.invites.code"), inviteResult.code);
    }
  };

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

  const openBankTransferDetail = () => {
    nav.navigate("BusinessOrderPending", {
      companyName: activeOrganization?.name,
      orderNumber: activeOrder?.orderNumber,
      requestedSeats: seats,
      status: activeOrganization?.status,
      variableSymbol: activeOrder?.variableSymbol,
      paymentReference: activeOrder?.paymentReference,
      billingEmail: activeOrganization?.billingEmail,
    });
  };

  const infoRows: Array<{ label: string; value: string | null }> = [
    { label: t("business.dashboard.detailsCompany"), value: companyName },
    { label: t("business.dashboard.detailsStatus"), value: statusLabel },
    { label: t("business.dashboard.detailsPlan"), value: planLabel },
    {
      label: t("business.dashboard.detailsLicenses"),
      value: `${usedSeats} / ${seatsLimit || seats}`,
    },
    { label: t("business.dashboard.detailsBillingPeriod"), value: billingPeriodLabel },
    { label: t("business.dashboard.detailsOrderNumber"), value: activeOrder?.orderNumber ?? null },
    { label: t("business.dashboard.detailsVariableSymbol"), value: activeOrder?.variableSymbol ?? null },
    {
      label: t("business.dashboard.detailsPaymentReference"),
      value: activeOrder?.paymentReference ?? null,
    },
    { label: t("business.dashboard.detailsBillingEmail"), value: activeOrganization?.billingEmail ?? null },
    { label: t("business.dashboard.detailsAmount"), value: amountGross !== null ? amountLabel : null },
    { label: t("business.dashboard.detailsTrialEnds"), value: trialEndsLabel },
  ];

  const showComingSoon = (titleKey: string) => {
    Alert.alert(t(titleKey), t("business.dashboard.actionComingSoon"));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerMeta}>
            <Text style={styles.companyName}>{companyName}</Text>
            <Text style={styles.planName}>{planLabel}</Text>
            <Text style={styles.licenseLine}>
              {t("business.dashboard.headerLicensesLine", {
                used: String(usedSeats),
                limit: String(seatsLimit || seats),
                free: String(freeSeats),
              })}
            </Text>
          </View>
          <TouchableOpacity style={styles.infoButton} onPress={() => setShowBusinessInfo(true)}>
            <Text style={styles.infoButtonText}>i</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.statusBadge, statusBadgeStyle]}>
          <Text style={styles.statusBadgeText}>{statusBadgeLabel}</Text>
        </View>
      </View>

      {(isTrialing || isPendingPayment) && !isLegacyPending ? (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>{t("business.dashboard.activation.title")}</Text>
          <Text style={styles.bannerBody}>{t("business.dashboard.activation.body")}</Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity style={styles.primaryButton} onPress={() => void onPayOnlinePress()}>
              <Text style={styles.primaryButtonText}>{t("business.dashboard.activation.payOnline")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, !canChangePlan && styles.buttonDisabled]}
              disabled={!canChangePlan}
              onPress={openChangePlan}
            >
              <Text style={styles.secondaryButtonText}>{t("business.dashboard.activation.changePlan")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={openBankTransferDetail}>
              <Text style={styles.linkButtonText}>{t("business.dashboard.activation.bankTransfer")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("business.dashboard.teamCardTitle")}</Text>
        <Text style={styles.cardBody}>
          {t("business.dashboard.teamCardUsed", {
            used: String(usedSeats),
            limit: String(seatsLimit || seats),
          })}
        </Text>
        <Text style={styles.cardBody}>{t("business.dashboard.teamCardFree", { free: String(freeSeats) })}</Text>
        {pendingInvites.length > 0 ? (
          <Text style={styles.pendingInfoText}>
            {t("business.dashboard.teamCardPending", { count: String(pendingInvites.length) })}
          </Text>
        ) : null}
        {membersLoading ? (
          <Text style={styles.emptyText}>{t("loading.text")}</Text>
        ) : membersReadBlocked ? (
          <Text style={styles.warningText}>{t("common.error")}</Text>
        ) : previewMembers.length === 0 ? (
          <Text style={styles.emptyText}>{t("business.team.summary.membersCount", { count: "0" })}</Text>
        ) : (
          <View style={styles.membersList}>
            {previewMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                t={t}
                currentUserUid={authUser?.uid}
                currentUserDisplayName={authUser?.displayName ?? undefined}
                currentUserEmail={authUser?.email ?? undefined}
                activeMembershipEmail={(activeMembership as { emailLower?: string } | null)?.emailLower}
              />
            ))}
          </View>
        )}
        <View style={styles.teamActions}>
          <TouchableOpacity
            style={[styles.secondaryButton, !canManageTeam && styles.buttonDisabled]}
            disabled={!canManageTeam}
            onPress={openInviteMemberModal}
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.teamLicenses.inviteMember")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, !canManageTeam && styles.buttonDisabled]}
            disabled={!canManageTeam}
            onPress={() => nav.navigate("BusinessTeamManagement")}
          >
            <Text style={styles.secondaryButtonText}>{t("business.dashboard.teamLicenses.manageTeam")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <ActionCard
          icon="people-outline"
          title={t("business.dashboard.modules.team")}
          body={t("business.dashboard.actionTeamBody")}
          openLabel={t("business.dashboard.modules.open")}
          onPress={() => nav.navigate("BusinessTeamManagement")}
        />
        <ActionCard
          icon="card-outline"
          title={t("business.dashboard.modules.customers")}
          body={t("business.dashboard.actionCustomersBody")}
          openLabel={t("business.dashboard.modules.open")}
          onPress={() => nav.navigate("BusinessCustomersList")}
        />
        <ActionCard
          icon="construct-outline"
          title={t("business.dashboard.modules.projects")}
          body={t("business.dashboard.actionProjectsBody")}
          openLabel={t("business.dashboard.modules.open")}
          onPress={() => showComingSoon("business.dashboard.modules.projects")}
        />
        <ActionCard
          icon="checkmark-done-outline"
          title={t("business.dashboard.modules.tasks")}
          body={t("business.dashboard.actionTasksBody")}
          openLabel={t("business.dashboard.modules.open")}
          onPress={() => showComingSoon("business.dashboard.modules.tasks")}
        />
        <ActionCard
          icon="chatbubbles-outline"
          title={t("business.dashboard.modules.inbox")}
          body={t("business.dashboard.actionMessagesBody")}
          openLabel={t("business.dashboard.modules.open")}
          onPress={() => nav.navigate("BusinessChatList")}
        />
      </View>

      <Modal
        visible={showBusinessInfo}
        animationType="slide"
        transparent
        onRequestClose={() => setShowBusinessInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("business.dashboard.detailsTitle")}</Text>
              <TouchableOpacity onPress={() => setShowBusinessInfo(false)}>
                <Text style={styles.modalClose}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {infoRows
                .filter((row) => row.value && row.value !== "—")
                .map((row) => (
                  <View key={row.label} style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{row.label}</Text>
                    <Text style={styles.infoValue}>{row.value}</Text>
                  </View>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showInviteModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("business.invites.createTitle")}</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <Text style={styles.modalClose}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>{t("business.invites.role")}</Text>
            <View style={styles.roleWrap}>
              {(["worker", "manager", "viewer", "admin"] as BusinessInviteRole[]).map((role) => {
                const active = inviteRole === role;
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.roleChip, active && styles.roleChipActive]}
                    onPress={() => setInviteRole(role)}
                  >
                    <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                      {t(`business.dashboard.teamLicenses.role.${role}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>{t("business.invites.emailOptional")}</Text>
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder={t("business.invites.emailOptional")}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            {!inviteEmail.trim() ? <Text style={styles.inviteHint}>{t("business.invites.stableCodeHint")}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryButton, inviteBusy && styles.buttonDisabled]}
              disabled={inviteBusy}
              onPress={onGenerateInviteCode}
            >
              <Text style={styles.primaryButtonText}>
                {inviteEmail.trim() ? t("business.invites.generateCode") : t("business.invites.showJoinCode")}
              </Text>
            </TouchableOpacity>

            {inviteResult ? (
              <ScrollView style={styles.inviteResultWrap}>
                <Text style={styles.fieldLabel}>{t("business.invites.codeReady")}</Text>
                <Text style={styles.inviteCode}>{inviteResult.code}</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={onCopyInviteCode}>
                  <Text style={styles.secondaryButtonText}>{t("business.invites.copyCode")}</Text>
                </TouchableOpacity>
                <Text style={styles.deepLinkText}>{inviteResult.deepLink}</Text>
                <Text style={styles.emptyText}>{t("business.invites.qrComingSoon")}</Text>
                {inviteResult.expiresAt ? (
                  <Text style={styles.pendingInfoText}>
                    {t("business.invites.expires", { date: new Date(inviteResult.expiresAt).toLocaleDateString() })}
                  </Text>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function getMemberDisplay(
  member: MembershipDoc,
  options?: {
    currentUserUid?: string;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    activeMembershipEmail?: string;
  }
): string {
  const displayName = (member.displayName ?? "").trim();
  if (displayName) return displayName;
  const name = ((member as { name?: string }).name ?? "").trim();
  if (name) return name;
  const email = (member.email ?? member.emailLower ?? "").trim();
  if (email) return email;
  const isCurrentUser = Boolean(options?.currentUserUid && member.userId === options.currentUserUid);
  if (isCurrentUser) {
    const currentUserDisplayName = (options?.currentUserDisplayName ?? "").trim();
    if (currentUserDisplayName) return currentUserDisplayName;
    const currentUserEmail = (options?.currentUserEmail ?? "").trim();
    if (currentUserEmail) return currentUserEmail;
    const activeMembershipEmail = (options?.activeMembershipEmail ?? "").trim();
    if (activeMembershipEmail) return activeMembershipEmail;
  }
  return member.userId || member.id || "—";
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

function memberStatusI18nKey(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return "business.team.status.active";
  if (s === "pending") return "business.team.status.pending";
  if (s === "invited") return "business.team.status.invited";
  return "business.team.status.pending";
}

function MemberRow({
  member,
  t,
  currentUserUid,
  currentUserDisplayName,
  currentUserEmail,
  activeMembershipEmail,
}: {
  member: MembershipDoc;
  t: (key: string, params?: Record<string, string>) => string;
  currentUserUid?: string;
  currentUserDisplayName?: string;
  currentUserEmail?: string;
  activeMembershipEmail?: string;
}) {
  const display = getMemberDisplay(member, {
    currentUserUid,
    currentUserDisplayName,
    currentUserEmail,
    activeMembershipEmail,
  });
  const role = member.role || "viewer";
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{getInitials(display)}</Text>
      </View>
      <View style={styles.memberMeta}>
        <Text style={styles.memberName} numberOfLines={1}>
          {display}
        </Text>
        <Text style={styles.memberRoleLine}>
          {t(`business.dashboard.teamLicenses.role.${role}`)} · {t(memberStatusI18nKey(member.status))}
        </Text>
      </View>
    </View>
  );
}

function ActionCard({
  icon,
  title,
  body,
  openLabel,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  openLabel: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress}>
      <View style={styles.actionIconWrap}>
        <Ionicons name={icon} size={22} color="#1E3A8A" />
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionBody} numberOfLines={2}>
        {body}
      </Text>
      <Text style={styles.actionOpen}>{openLabel} ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerMeta: {
    flex: 1,
  },
  companyName: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0F172A",
  },
  planName: {
    marginTop: 2,
    fontSize: 15,
    color: "#334155",
    fontWeight: "600",
  },
  licenseLine: {
    marginTop: 8,
    fontSize: 14,
    color: "#475569",
  },
  infoButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  infoButtonText: {
    color: "#334155",
    fontWeight: "700",
  },
  statusBadge: {
    marginTop: 12,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeWarning: {
    backgroundColor: "#FEF3C7",
  },
  badgeTrial: {
    backgroundColor: "#DBEAFE",
  },
  badgeSuccess: {
    backgroundColor: "#DCFCE7",
  },
  statusBadgeText: {
    color: "#1E293B",
    fontSize: 12,
    fontWeight: "700",
  },
  banner: {
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    padding: 14,
  },
  bannerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
  },
  bannerBody: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  bannerActions: {
    marginTop: 10,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 14,
    color: "#334155",
    marginBottom: 4,
  },
  pendingInfoText: {
    marginTop: 2,
    fontSize: 13,
    color: "#475569",
  },
  warningText: {
    marginTop: 6,
    fontSize: 13,
    color: colors.error,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    color: "#64748B",
  },
  membersList: {
    marginTop: 10,
    gap: 8,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#1E3A8A",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },
  memberMeta: {
    flex: 1,
  },
  memberName: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
  },
  memberRoleLine: {
    marginTop: 2,
    color: "#64748B",
    fontSize: 12,
  },
  teamActions: {
    marginTop: 10,
    gap: 8,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  actionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    width: "48.5%",
    minHeight: 150,
    padding: 12,
    justifyContent: "space-between",
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  actionOpen: {
    marginTop: 8,
    fontSize: 13,
    color: "#334155",
    fontWeight: "700",
    alignSelf: "flex-end",
  },
  actionBody: {
    marginTop: 4,
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontWeight: "700",
    fontSize: 15,
  },
  linkButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  linkButtonText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "88%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
  },
  modalClose: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "700",
  },
  infoRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  infoLabel: {
    color: "#64748B",
    fontSize: 12,
  },
  infoValue: {
    marginTop: 3,
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
  },
  fieldLabel: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 6,
    marginBottom: 6,
  },
  roleWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  roleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  roleChipActive: {
    borderColor: "#EA580C",
    backgroundColor: "#FFF7ED",
  },
  roleChipText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  roleChipTextActive: {
    color: "#9A3412",
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  inviteHint: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748B",
    marginBottom: 10,
  },
  inviteResultWrap: {
    marginTop: 10,
    maxHeight: 220,
  },
  inviteCode: {
    marginTop: 4,
    fontSize: 24,
    color: "#0F172A",
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  deepLinkText: {
    marginTop: 8,
    color: "#475569",
    fontSize: 12,
  },
});

