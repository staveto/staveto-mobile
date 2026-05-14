import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { colors, radius, spacing } from "../../theme";

export function BusinessLandingScreen() {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Staveto Business</Text>
      <Text style={styles.subtitle}>Firemný workspace pre stavebné tímy</Text>

      <View style={styles.benefitsCard}>
        <Text style={styles.benefit}>- firemný workspace</Text>
        <Text style={styles.benefit}>- projekty pre tím</Text>
        <Text style={styles.benefit}>- projektový chat</Text>
        <Text style={styles.benefit}>- fotky a videá ku stavbe</Text>
        <Text style={styles.benefit}>- zamestnanci a role</Text>
        <Text style={styles.benefit}>- dochádzka</Text>
        <Text style={styles.benefit}>- problémy</Text>
        <Text style={styles.benefit}>- mesačné prehľady</Text>
      </View>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => (navigation as { navigate: (name: string) => void }).navigate("BusinessRegistration")}
      >
        <Text style={styles.primaryButtonText}>Registrovať moju firmu</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => {
          if ((navigation as { canGoBack: () => boolean }).canGoBack()) {
            navigation.goBack();
          }
        }}
      >
        <Text style={styles.secondaryButtonText}>Pokračovať v osobnom Stavete</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  benefitsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  benefit: {
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  secondaryButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
});

