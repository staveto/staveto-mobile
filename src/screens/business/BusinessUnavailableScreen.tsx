import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

export function BusinessUnavailableScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Staveto Business nie je dostupné</Text>
      <Text style={styles.text}>Nemáte aktívny firemný prístup.</Text>
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
});

