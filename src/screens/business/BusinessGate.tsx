import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
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
  const { activeBusinessOrgId, loading } = useActiveOrg();
  const { orgStatus, canAccessBusiness, trialIsValid } = useOrgAccess();

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

  if (canAccessBusiness) {
    return <>{children}</>;
  }

  if (orgStatus === "pending_payment" && !trialIsValid) {
    return <PendingPaymentScreen />;
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

