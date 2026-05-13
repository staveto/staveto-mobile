import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

export function AdminHomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Staveto Admin</Text>
      <Text style={styles.subtitle}>Interná administrácia Staveto Business</Text>

      <View style={styles.sectionList}>
        <Text style={styles.sectionItem}>- Firmy</Text>
        <Text style={styles.sectionItem}>- Licencie</Text>
        <Text style={styles.sectionItem}>- Faktúry</Text>
      </View>
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
    marginBottom: 18,
  },
  sectionList: {
    width: "100%",
    maxWidth: 360,
    paddingHorizontal: 12,
  },
  sectionItem: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: 8,
  },
});

