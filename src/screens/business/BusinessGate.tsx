import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { colors } from "../../theme";
import { PendingPaymentScreen } from "./PendingPaymentScreen";
import { SuspendedBusinessScreen } from "./SuspendedBusinessScreen";
import { BusinessUnavailableScreen } from "./BusinessUnavailableScreen";

type BusinessGateProps = {
  children: React.ReactNode;
};

export function BusinessGate({ children }: BusinessGateProps) {
  const { user } = useAuth();
  const { activeBusinessOrgId, activeOrganization, activeMembership, loading } = useActiveOrg();
  const {
    orgStatus,
    canAccessBusiness,
    canViewBusinessDashboard,
    isWorker,
    isViewer,
    pendingCanAccess,
    trialActive,
    hasActiveBusinessOrder,
    businessEnabled,
    dashboardBlockReason,
  } = useOrgAccess();

  const finalDecision = useMemo(() => {
    if (loading) return "loading";
    if (!activeBusinessOrgId) return "unavailable";
    if (orgStatus === "suspended") return "suspended";
    if (orgStatus === "cancelled") return "unavailable";
    if (orgStatus === "pending_payment" && !canViewBusinessDashboard) return "pending_payment";
    if (canViewBusinessDashboard) return "dashboard";
    return "unavailable";
  }, [loading, activeBusinessOrgId, orgStatus, canViewBusinessDashboard]);

  useEffect(() => {
    console.log("[BusinessGateDebug]", {
      authUid: user?.id ?? null,
      activeBusinessOrgId,
      orgId: activeOrganization?.id ?? null,
      orgStatus: activeOrganization?.status ?? null,
      businessEnabled: activeOrganization?.businessEnabled ?? null,
      trialEndsAt: activeOrganization?.trialEndsAt ?? null,
      activeBusinessOrderId: activeOrganization?.activeBusinessOrderId ?? null,
      orderNumber: (activeOrganization as { orderNumber?: string } | null)?.orderNumber ?? null,
      membershipId: activeMembership?.id ?? null,
      membershipUserId: activeMembership?.userId ?? null,
      membershipRole: activeMembership?.role ?? null,
      membershipStatus: activeMembership?.status ?? null,
      trialActive,
      hasActiveBusinessOrder,
      pendingCanAccess,
      canAccessBusiness,
      canViewBusinessDashboard,
      isWorker,
      isViewer,
      dashboardBlockReason,
      finalDecision,
    });
  }, [
    user?.id,
    activeBusinessOrgId,
    activeOrganization,
    activeMembership,
    trialActive,
    hasActiveBusinessOrder,
    pendingCanAccess,
    canAccessBusiness,
    canViewBusinessDashboard,
    isWorker,
    isViewer,
    dashboardBlockReason,
    finalDecision,
  ]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Načítavam business workspace…</Text>
      </View>
    );
  }

  if (!activeBusinessOrgId) {
    return <BusinessUnavailableScreen reason={dashboardBlockReason} />;
  }

  if (orgStatus === "suspended") {
    return <SuspendedBusinessScreen />;
  }

  if (orgStatus === "cancelled") {
    return <BusinessUnavailableScreen reason={dashboardBlockReason} />;
  }

  if (orgStatus === "pending_payment" && !canViewBusinessDashboard) {
    if (isWorker || isViewer) {
      return <BusinessUnavailableScreen reason="employee_use_projects" />;
    }
    return (
      <PendingPaymentScreen
        debugReason={dashboardBlockReason}
        orgStatus={orgStatus ?? undefined}
        businessEnabled={businessEnabled}
        membershipStatus={activeMembership?.status}
      />
    );
  }

  if (canViewBusinessDashboard) {
    return <>{children}</>;
  }

  return <BusinessUnavailableScreen reason={dashboardBlockReason} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: colors.textMuted,
  },
});
