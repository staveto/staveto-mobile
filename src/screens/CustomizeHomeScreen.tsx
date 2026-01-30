import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../theme";

export function CustomizeHomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Prispôsobiť úvodnú obrazovku</Text>
      <Text style={styles.coming}>Možnosti prispôsobenia čoskoro.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  title: { fontSize: 20, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  coming: { fontSize: 14, color: colors.textMuted },
});
