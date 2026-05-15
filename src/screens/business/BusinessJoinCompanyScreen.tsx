import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { redeemBusinessInviteCode } from "../../services/businessInvites";
import { useBusinessContext } from "../../hooks/useBusinessContext";
import { colors } from "../../theme";

type RouteParams = {
  prefilledCode?: string;
};

export function BusinessJoinCompanyScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const params = (route.params ?? {}) as RouteParams;
  const { setActiveBusinessOrgId, refreshActiveBusinessOrg } = useBusinessContext();
  const [code, setCode] = useState((params.prefilledCode ?? "").trim());
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      Alert.alert(t("business.join.invalidCode"), t("business.join.codePlaceholder"));
      return;
    }
    setBusy(true);
    try {
      const result = await redeemBusinessInviteCode({ code: normalizedCode });
      if (result.status === "active") {
        setActiveBusinessOrgId(result.orgId);
        await refreshActiveBusinessOrg();
        Alert.alert(t("business.join.successActiveTitle"), t("business.join.successActiveBody"));
        (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate("BusinessDashboard");
        return;
      }
      Alert.alert(t("business.join.pendingTitle"), t("business.join.pendingBody"));
      (navigation as unknown as { goBack: () => void }).goBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("business.join.invalidCode"), message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("business.join.title")}</Text>
      <Text style={styles.subtitle}>{t("business.join.subtitle")}</Text>
      <Text style={styles.label}>{t("business.join.enterCode")}</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
        placeholder={t("business.join.codePlaceholder")}
        placeholderTextColor="#64748B"
      />
      <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={onSubmit}>
        <Text style={styles.buttonText}>{t("business.join.submit")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
    padding: 16,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 8,
    color: "#CBD5E1",
    fontSize: 14,
  },
  label: {
    marginTop: 16,
    color: "#E2E8F0",
    fontSize: 12,
  },
  input: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    color: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
});
