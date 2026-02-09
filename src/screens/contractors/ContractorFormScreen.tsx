import React, { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { createContractor, getContractor, updateContractor } from "../../services/contractors";
import { getUserSettings } from "../../services/features";
import { colors, radius, spacing } from "../../theme";

export function ContractorFormScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useI18n();
  const { user } = useAuth();
  const contractorId = (route.params as { contractorId?: string })?.contractorId;
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!user?.id || !contractorId) return;
      setLoading(true);
      try {
        const data = await getContractor(user.id, contractorId);
        if (data) {
          setDisplayName(data.displayName);
          setPhone(data.phoneRaw || data.phoneE164);
          setEmail(data.email ?? "");
          setNote(data.note ?? "");
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id, contractorId]);

  const onSave = async () => {
    if (!displayName.trim() || !phone.trim()) {
      Alert.alert(t("common.error"), t("contractors.required"));
      return;
    }
    if (!user?.id) return;
    setLoading(true);
    try {
      const settings = await getUserSettings(user.id);
      const region = settings.country || "SK";
      if (contractorId) {
        await updateContractor(contractorId, { displayName, phone, email, note }, region);
      } else {
        await createContractor({ displayName, phone, email, note }, region);
      }
      (navigation as { goBack: () => void }).goBack();
    } catch (e) {
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{contractorId ? t("contractors.edit") : t("contractors.add")}</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t("contractors.name")}
        placeholderTextColor={colors.textMuted}
      />
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={t("contractors.phone")}
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
      />
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder={t("contractors.email")}
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        value={note}
        onChangeText={setNote}
        placeholder={t("contractors.note")}
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t("common.save")}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  saveBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "600" },
});
