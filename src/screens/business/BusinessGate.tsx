import React, { useEffect } from "react";
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
    pendingCanAccess,
    trialActive,
    dashboardBlockReason,
  } = useOrgAccess();

  useEffect(() => {
    if (loading) return;
    console.log("[BusinessGateDebug]", {
      authUid: user?.id ?? null,
      activeBusinessOrgId,
      orgId: activeOrganization?.id ?? null,
      orgStatus: activeOrganization?.status ?? null,
      businessEnabled: activeOrganization?.businessEnabled ?? null,
      trialEndsAt: activeOrganization?.trialEndsAt ?? null,
      activeBusinessOrderId: activeOrganization?.activeBusinessOrderId ?? null,
      membershipId: activeMembership?.id ?? null,
      membershipUserId: activeMembership?.userId ?? null,
      membershipRole: activeMembership?.role ?? null,
      membershipStatus: activeMembership?.status ?? null,
      canAccessBusiness,
      canViewBusinessDashboard,
      pendingCanAccess,
      trialActive,
      dashboardBlockReason,
    });
  }, [
    loading,
    user?.id,
    activeBusinessOrgId,
    activeOrganization,
    activeMembership,
    canAccessBusiness,
    canViewBusinessDashboard,
    pendingCanAccess,
    trialActive,
    dashboardBlockReason,
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
    return <BusinessUnavailableScreen />;
  }

  if (orgStatus === "suspended") {
    return <SuspendedBusinessScreen />;
  }

  if (orgStatus === "cancelled") {
    return <BusinessUnavailableScreen />;
  }

  if (orgStatus === "pending_payment" && !canViewBusinessDashboard) {
    return <PendingPaymentScreen />;
  }

  if (canViewBusinessDashboard || canAccessBusiness) {
    return <>{children}</>;
  }

  return <BusinessUnavailableScreen />;
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
