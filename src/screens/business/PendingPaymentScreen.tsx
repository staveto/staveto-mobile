import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/I18nContext";
import { colors } from "../../theme";

export function PendingPaymentScreen() {
  const { t } = useI18n();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("business.pendingFallback.title")}</Text>
      <Text style={styles.text}>{t("business.pendingFallback.body")}</Text>
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
    color: colors.textOnDark,
    marginBottom: 10,
  },
  text: {
    fontSize: 15,
    textAlign: "center",
    color: "#dce8f6",
  },
});

