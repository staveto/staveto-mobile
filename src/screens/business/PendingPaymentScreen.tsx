import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

type PendingPaymentScreenProps = {
  debugReason?: string;
  orgStatus?: string;
  businessEnabled?: boolean;
  membershipStatus?: string;
};

export function PendingPaymentScreen({
  debugReason,
  orgStatus,
  businessEnabled,
  membershipStatus,
}: PendingPaymentScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Čakáme na úhradu faktúry</Text>
      <Text style={styles.text}>Po prijatí platby vám aktivujeme Staveto Business.</Text>
      {__DEV__ && debugReason ? (
        <View style={styles.debugBox}>
          <Text style={styles.debugText}>reason: {debugReason}</Text>
          <Text style={styles.debugText}>org.status: {orgStatus ?? "—"}</Text>
          <Text style={styles.debugText}>
            businessEnabled: {businessEnabled === true ? "true" : String(businessEnabled ?? "null")}
          </Text>
          <Text style={styles.debugText}>membership.status: {membershipStatus ?? "—"}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    color: colors.text,
    marginBottom: 10,
  },
  text: {
    fontSize: 15,
    textAlign: "center",
    color: colors.textMuted,
  },
  debugBox: {
    marginTop: 20,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(15, 23, 42, 0.06)",
    alignSelf: "stretch",
  },
  debugText: {
    fontSize: 11,
    fontFamily: "monospace",
    color: colors.textMuted,
    marginBottom: 4,
  },
});
