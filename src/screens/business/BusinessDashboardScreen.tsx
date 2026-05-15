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
import { translations } from "../../i18n/translations";
import { getAuth } from "../../firebase";
import { getBusinessOrder, type BusinessOrderDoc } from "../../services/organizations";
import { listMembers, type MembershipDoc } from "../../services/businessMembers";
import { createBusinessCheckoutSession } from "../../services/businessPayments";
import {
  createBusinessInviteCode,
  type BusinessInviteRole,
  type CreateBusinessInviteCodeResult,
} from "../../services/businessInvites";
import { colors } from "../../theme";

let InviteQrCode: React.ComponentType<{ value: string; size: number }> | null = null;
try {
  InviteQrCode = require("react-native-qrcode-svg").default;
} catch {
  InviteQrCode = null;
}

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

function getErrorDetails(error: unknown): { code: string; message: string } {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  return { code, message };
}

function normalizeParams(params?: Record<string, string | number>): Record<string, string> | undefined {
  if (!params) return undefined;
  return Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = String(value);
    return acc;
  }, {});
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return Object.entries(params).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), String(value));
  }, template);
}

function getEmailLocalPart(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return "";
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return "";
  return trimmed.slice(0, atIndex);
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
  const displayName = ((member as { displayName?: string }).displayName ?? "").trim();
  if (displayName) return displayName;
  const name = ((member as { name?: string }).name ?? "").trim();
  if (name) return name;

  const emailValue = (
    (member as { email?: string; emailLower?: string }).email ??
    (member as { email?: string; emailLower?: string }).emailLower ??
    ""
  ).trim();
  if (emailValue) return emailValue;

  const emailLocalPart = getEmailLocalPart(emailValue);
  if (emailLocalPart) return emailLocalPart;

  const isCurrentUser = Boolean(options?.currentUserUid && member.userId === options.currentUserUid);
  if (isCurrentUser) {
    const currentUserDisplayName = (options?.currentUserDisplayName ?? "").trim();
    if (currentUserDisplayName) return currentUserDisplayName;

    const currentUserEmail = (options?.currentUserEmail ?? "").trim();
    if (currentUserEmail) return currentUserEmail;
    const currentEmailLocal = getEmailLocalPart(currentUserEmail);
    if (currentEmailLocal) return currentEmailLocal;

    const activeMembershipEmail = (options?.activeMembershipEmail ?? "").trim();
    if (activeMembershipEmail) return activeMembershipEmail;
    const activeMembershipEmailLocal = getEmailLocalPart(activeMembershipEmail);
    if (activeMembershipEmailLocal) return activeMembershipEmailLocal;
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

export function BusinessDashboardScreen() {
  const { activeOrganization, activeMembership } = useActiveOrg();
  const { t } = useI18n();
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const [activeOrder, setActiveOrder] = useState<BusinessOrderDoc | null>(null);
  const [orgMembers, setOrgMembers] = useState<MembershipDoc[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersReadBlocked, setMembersReadBlocked] = useState(false);
  const [showBusinessInfo, setShowBusinessInfo] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<BusinessInviteRole>("worker");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<CreateBusinessInviteCodeResult | null>(null);
  const authUser = getAuth()?.currentUser ?? null;

  const tr = (key: string, params?: Record<string, string | number>, fallback?: string): string => {
    const normalized = normalizeParams(params);
    const resolved = t(key, normalized);
    if (resolved !== key) return resolved;
    const en = translations.en[key];
    if (typeof en === "string") return interpolate(en, params);
    if (fallback) return interpolate(fallback, params);
    return key;
  };

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
    if (planCode === "business_starter") return tr("business.planSelection.starterTitle");
    if (planCode === "business_team") return tr("business.planSelection.teamTitle");
    if (planCode === "business_company") return tr("business.planSelection.companyTitle");
    if (planCode === "business_enterprise") return tr("business.planSelection.enterpriseTitle");
    return "Business";
  }, [activeOrder?.planCode, activeOrder?.priceSnapshot?.planCode, activeOrganization?.planCode]);

  const isPendingPayment = activeOrganization?.status === "pending_payment";
  const isTrialing = activeOrganization?.status === "trialing";
  const orgRequestedSeats =
    (activeOrganization as { requestedSeats?: number } | null)?.requestedSeats ?? null;
  const seats = orgRequestedSeats ?? activeOrder?.requestedSeats ?? activeOrganization?.seatsLimit ?? 0;
  const seatsLimit = activeOrganization?.seatsLimit || orgRequestedSeats || 0;
  const billingPeriodRaw =
    activeOrganization?.billingPeriod ??
    activeOrder?.billingPeriod ??
    activeOrder?.priceSnapshot?.billingPeriod ??
    "manual";
  const billingPeriodLabel =
    billingPeriodRaw === "yearly"
      ? tr("business.planSelection.billingYearly")
      : billingPeriodRaw === "monthly"
      ? tr("business.planSelection.billingMonthly")
      : tr("business.dashboard.billingManual", undefined, "Manual billing");
  const companyName =
    activeOrganization?.name ||
    (activeOrganization as { companyName?: string } | null)?.companyName ||
    "Business";

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
  const previewMembers = memberCandidates.slice(0, 3);
  const canManageTeam =
    activeMembership?.role === "owner" ||
    activeMembership?.role === "admin" ||
    activeMembership?.role === "manager";
  const canChangePlan = activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const orgId = activeOrganization?.id ?? null;
  const orderId = activeOrder?.id ?? activeOrganization?.activeBusinessOrderId ?? null;
  const statusBadgeLabel = isPendingPayment
    ? tr("business.dashboard.badgePaymentDue", undefined, "Payment due")
    : isTrialing
    ? tr("business.dashboard.badgeTrial", undefined, "Trial")
    : tr("business.dashboard.badgeActive", undefined, "Active");
  const statusLabel = isPendingPayment
    ? tr("business.pending.statusPendingPayment", undefined, "pending_payment")
    : isTrialing
    ? tr("business.pending.statusTrialing", undefined, "trialing")
    : tr("business.pending.statusActive", undefined, "active");
  const statusBadgeStyle = isPendingPayment
    ? styles.badgeWarning
    : isTrialing
    ? styles.badgeTrial
    : styles.badgeSuccess;
  const trialEndsLabel = formatDate(activeOrganization?.trialEndsAt);
  const amountGross =
    activeOrder?.paymentInstructions?.amountGross ??
    activeOrder?.priceSnapshot?.totalGross ??
    null;
  const amountLabel =
    amountGross !== null
      ? tr("business.dashboard.amountLabel", { amount: String(amountGross) }, "{{amount}} EUR")
      : "—";

  const openChangePlan = () => {
    if (!orgId || !orderId) {
      Alert.alert(
        tr("business.dashboard.paymentStartFailedTitle", undefined, "Could not start payment"),
        tr("business.dashboard.selectPlanFirstBody", undefined, "Select a Business plan first.")
      );
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
      Alert.alert(
        tr("business.dashboard.paymentStartFailedTitle", undefined, "Could not start payment"),
        tr("business.dashboard.selectPlanFirstBody", undefined, "Select a Business plan first.")
      );
      return;
    }
    try {
      Alert.alert(
        tr("business.dashboard.payOnlineTitle", undefined, "Pay online"),
        tr("business.dashboard.openingStripeCheckout", undefined, "Opening Stripe checkout...")
      );
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
          tr("business.dashboard.selectPlanFirstTitle", undefined, "Select Business plan"),
          tr("business.dashboard.selectPlanFirstBody", undefined, "Select a Business plan first."),
          [
            { text: tr("common.cancel", undefined, "Cancel"), style: "cancel" },
            { text: tr("business.dashboard.changePlanCta", undefined, "Change plan"), onPress: openChangePlan },
          ]
        );
        return;
      }
      Alert.alert(
        tr("business.dashboard.paymentStartFailedTitle", undefined, "Could not start payment"),
        `${tr("business.dashboard.paymentStartFailedBody", undefined, "Try again in a moment.")}\n${details.code}: ${details.message}`
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

  const openInviteMemberModal = () => {
    setInviteResult(null);
    setInviteRole("worker");
    setInviteEmail("");
    setShowInviteModal(true);
  };

  const onGenerateInviteCode = async () => {
    if (!orgId) {
      Alert.alert(tr("common.error", undefined, "Error"), tr("business.dashboard.companyFallback", undefined, "Business organization"));
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
      const details = getErrorDetails(error);
      Alert.alert(
        tr("common.error", undefined, "Error"),
        `${tr("business.registration.alert.submitFailedBody", undefined, "Please try again.")}\n${details.code}: ${details.message}`
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
      Alert.alert(tr("business.invites.copied", undefined, "Copied"));
    } catch {
      Alert.alert(tr("business.invites.code", undefined, "Code"), inviteResult.code);
    }
  };

  const infoRows: Array<{ label: string; value: string | null }> = [
    { label: tr("business.dashboard.detailsCompany", undefined, "Company"), value: companyName },
    { label: tr("business.dashboard.detailsStatus", undefined, "Status"), value: statusLabel },
    { label: tr("business.dashboard.detailsPlan", undefined, "Plan"), value: planLabel },
    { label: tr("business.dashboard.detailsLicenses", undefined, "Licenses"), value: `${usedSeats} / ${seatsLimit || seats}` },
    { label: tr("business.dashboard.detailsBillingPeriod", undefined, "Billing period"), value: billingPeriodLabel },
    { label: tr("business.dashboard.detailsOrderNumber", undefined, "Order number"), value: activeOrder?.orderNumber ?? null },
    { label: tr("business.dashboard.detailsVariableSymbol", undefined, "Variable symbol"), value: activeOrder?.variableSymbol ?? null },
    { label: tr("business.dashboard.detailsPaymentReference", undefined, "Payment reference"), value: activeOrder?.paymentReference ?? null },
    { label: tr("business.dashboard.detailsBillingEmail", undefined, "Billing email"), value: activeOrganization?.billingEmail ?? null },
    { label: tr("business.dashboard.detailsAmount", undefined, "Amount"), value: amountGross !== null ? amountLabel : null },
    { label: tr("business.dashboard.detailsTrialEnds", undefined, "Trial end date"), value: trialEndsLabel ?? null },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerMeta}>
            <Text style={styles.companyName}>{companyName}</Text>
            <Text style={styles.planName}>{planLabel}</Text>
            <Text style={styles.licenseLine}>
              {tr(
                "business.dashboard.headerLicensesLine",
                {
                  used: String(usedSeats),
                  limit: String(seatsLimit || seats),
                  free: String(freeSeats),
                },
                "{{used}} / {{limit}} licenses · {{free}} free"
              )}
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

      {(isTrialing || isPendingPayment) && (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>
            {tr("business.dashboard.paymentBannerTitle", undefined, "Activate Business")}
          </Text>
          <Text style={styles.bannerBody}>
            {tr(
              "business.dashboard.paymentBannerBody",
              undefined,
              "Your business workspace is ready. You can activate the subscription now or after the trial period."
            )}
          </Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity style={styles.primaryButton} onPress={onPayOnlinePress}>
              <Text style={styles.primaryButtonText}>
                {tr("business.dashboard.payOnlineCta", undefined, "Zaplatit online")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, !canChangePlan && styles.buttonDisabled]}
              disabled={!canChangePlan}
              onPress={openChangePlan}
            >
              <Text style={styles.secondaryButtonText}>
                {tr("business.dashboard.changePlanCta", undefined, "Zmenit plan")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={openBankTransferDetail}>
              <Text style={styles.linkButtonText}>
                {tr("business.dashboard.bankTransferCta", undefined, "Bankovy prevod")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{tr("business.dashboard.teamCardTitle", undefined, "Tim a licencie")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "business.dashboard.teamCardUsed",
            { used: String(usedSeats), limit: String(seatsLimit || seats) },
            "{{used}} / {{limit}} pouzitych"
          )}
        </Text>
        <Text style={styles.cardBody}>
          {tr("business.dashboard.teamCardFree", { free: String(freeSeats) }, "{{free}} volne licencie")}
        </Text>
        {pendingInvites.length > 0 ? (
          <Text style={styles.pendingInfoText}>
            {tr("business.dashboard.teamCardPending", { count: String(pendingInvites.length) }, "{{count}} cakajucich pozvanok")}
          </Text>
        ) : null}
        {membersLoading ? (
          <Text style={styles.emptyText}>{tr("loading.text", undefined, "Loading...")}</Text>
        ) : membersReadBlocked ? (
          <Text style={styles.warningText}>
            {tr("business.dashboard.teamLicenses.membersReadBlocked", undefined, "Members are temporarily unavailable.")}
          </Text>
        ) : previewMembers.length === 0 ? (
          <Text style={styles.emptyText}>
            {tr("business.dashboard.teamLicenses.noMembers", undefined, "No members yet.")}
          </Text>
        ) : (
          <View style={styles.membersList}>
            {previewMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                tr={tr}
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
            <Text style={styles.secondaryButtonText}>
              {tr("business.dashboard.teamCardInvite", undefined, "Pozvat clena")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, !canManageTeam && styles.buttonDisabled]}
            disabled={!canManageTeam}
            onPress={() => nav.navigate("BusinessTeamManagement")}
          >
            <Text style={styles.secondaryButtonText}>
              {tr("business.dashboard.teamCardManage", undefined, "Spravovat tim")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <ActionCard
          icon="people-outline"
          title={tr("business.dashboard.actionTeamTitle", undefined, "Tim")}
          body={tr("business.dashboard.actionTeamBody", undefined, "Spravujte clenov a roly.")}
          openLabel={tr("business.dashboard.actionOpen", undefined, "Open")}
          onPress={() =>
            Alert.alert(
              tr("business.dashboard.actionTeamTitle", undefined, "Tim"),
              tr("business.dashboard.teamLicenses.manageComingSoon", undefined, "Coming soon.")
            )
          }
        />
        <ActionCard
          icon="construct-outline"
          title={tr("business.dashboard.actionProjectsTitle", undefined, "Projekty")}
          body={tr("business.dashboard.actionProjectsBody", undefined, "Firemne projekty a stavby.")}
          openLabel={tr("business.dashboard.actionOpen", undefined, "Open")}
          onPress={() =>
            Alert.alert(
              tr("business.dashboard.actionProjectsTitle", undefined, "Projekty"),
              tr("business.dashboard.teamLicenses.manageComingSoon", undefined, "Coming soon.")
            )
          }
        />
        <ActionCard
          icon="checkmark-done-outline"
          title={tr("business.dashboard.actionTasksTitle", undefined, "Ulohy")}
          body={tr("business.dashboard.actionTasksBody", undefined, "Prehlad timovych uloh.")}
          openLabel={tr("business.dashboard.actionOpen", undefined, "Open")}
          onPress={() =>
            Alert.alert(
              tr("business.dashboard.actionTasksTitle", undefined, "Ulohy"),
              tr("business.dashboard.teamLicenses.manageComingSoon", undefined, "Coming soon.")
            )
          }
        />
        <ActionCard
          icon="chatbubbles-outline"
          title={tr("business.dashboard.actions.messages.title", undefined, "Spravy")}
          body={tr("business.dashboard.actions.messages.body", undefined, "Firemny inbox a chat.")}
          openLabel={tr("business.dashboard.actionOpen", undefined, "Open")}
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
              <Text style={styles.modalTitle}>
                {tr("business.dashboard.detailsTitle", undefined, "Business details")}
              </Text>
              <TouchableOpacity onPress={() => setShowBusinessInfo(false)}>
                <Text style={styles.modalClose}>{tr("common.close", undefined, "Close")}</Text>
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
              <Text style={styles.modalTitle}>{tr("business.invites.title", undefined, "Pozvat clena")}</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <Text style={styles.modalClose}>{tr("common.close", undefined, "Close")}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>{tr("business.invites.role", undefined, "Role")}</Text>
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
                      {tr(`business.dashboard.teamLicenses.role.${role}`, undefined, role)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>
              {tr("business.invites.emailOptional", undefined, "Email (optional)")}
            </Text>
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder={tr("business.invites.emailOptional", undefined, "Email (optional)")}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TouchableOpacity
              style={[styles.primaryButton, inviteBusy && styles.buttonDisabled]}
              disabled={inviteBusy}
              onPress={onGenerateInviteCode}
            >
              <Text style={styles.primaryButtonText}>
                {tr("business.invites.generateCode", undefined, "Vygenerovat kod")}
              </Text>
            </TouchableOpacity>

            {inviteResult ? (
              <ScrollView style={styles.inviteResultWrap}>
                <Text style={styles.infoLabel}>{tr("business.invites.code", undefined, "Code")}</Text>
                <Text style={styles.inviteCode}>{inviteResult.code}</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={onCopyInviteCode}>
                  <Text style={styles.secondaryButtonText}>
                    {tr("business.invites.copyCode", undefined, "Copy code")}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.deepLinkText}>{inviteResult.deepLink}</Text>
                {InviteQrCode ? (
                  <View style={styles.qrBox}>
                    <InviteQrCode value={inviteResult.deepLink} size={170} />
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {tr("business.invites.qrComingSoon", undefined, "QR code coming soon")}
                  </Text>
                )}
                {inviteResult.expiresAt ? (
                  <Text style={styles.pendingInfoText}>
                    {tr("business.invites.expires", { date: new Date(inviteResult.expiresAt).toLocaleDateString() }, "Expires {{date}}")}
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

function MemberRow({
  member,
  tr,
  currentUserUid,
  currentUserDisplayName,
  currentUserEmail,
  activeMembershipEmail,
}: {
  member: MembershipDoc;
  tr: (key: string, params?: Record<string, string | number>, fallback?: string) => string;
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
  const roleKey = `business.dashboard.teamLicenses.role.${role}`;
  const statusKey =
    member.status === "active"
      ? "business.dashboard.teamLicenses.statusActive"
      : "business.dashboard.teamLicenses.statusPending";
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
          {tr(roleKey, undefined, role)} · {tr(statusKey, undefined, member.status)}
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
    maxHeight: "75%",
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
  inviteResultWrap: {
    marginTop: 10,
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
  qrBox: {
    marginTop: 12,
    alignItems: "center",
  },
});
