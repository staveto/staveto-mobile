import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

export function PendingPaymentScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Čakáme na úhradu faktúry</Text>
      <Text style={styles.text}>Po prijatí platby vám aktivujeme Staveto Business.</Text>
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

