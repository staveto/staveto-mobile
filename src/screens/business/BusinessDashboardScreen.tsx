import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { colors } from "../../theme";

export function BusinessDashboardScreen() {
  const { activeOrganization } = useActiveOrg();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Staveto Business</Text>
      <Text style={styles.subtitle}>Firemný pracovný priestor</Text>
      <Text style={styles.text}>
        Tu bude dashboard pre projekty, tím, dochádzku a reporty.
      </Text>
      {activeOrganization?.name ? (
        <Text style={styles.orgName}>Organizácia: {activeOrganization.name}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    marginBottom: 14,
  },
  text: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 20,
  },
  orgName: {
    marginTop: 16,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
});

