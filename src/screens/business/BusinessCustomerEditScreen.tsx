import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { useI18n } from "../../i18n/I18nContext";
import {
  createBusinessCustomer,
  getBusinessCustomer,
  updateBusinessCustomer,
} from "../../services/businessCustomers";
import { colors } from "../../theme";

type RouteParams = { customerId?: string };

export function BusinessCustomerEditScreen() {
  const { t } = useI18n();
  const navigation = useNavigation() as unknown as {
    goBack: () => void;
    replace: (name: string, params: { customerId: string }) => void;
  };
  const route = useRoute() as { params?: RouteParams };
  const customerId = route.params?.customerId?.trim() ?? "";
  const isEdit = customerId.length > 0;
  const { activeOrganization } = useActiveOrg();
  const { canManageCustomers } = useOrgAccess();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const orgId = activeOrganization?.id;
    if (!isEdit || !orgId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await getBusinessCustomer(orgId, customerId);
        if (cancelled || !doc) return;
        setDisplayName(doc.displayName);
        setCompanyName(doc.companyName ?? "");
        setEmail(doc.email ?? "");
        setPhone(doc.phone ?? "");
        setAddress(doc.address ?? "");
        setNotes(doc.notes ?? "");
      } catch (error) {
        console.warn("[BusinessCustomerEdit] load failed", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrganization?.id, customerId, isEdit]);

  const onSave = useCallback(async () => {
    const orgId = activeOrganization?.id;
    if (!orgId || !canManageCustomers) return;
    const name = displayName.trim();
    if (!name) {
      Alert.alert("", t("business.customers.edit.displayNameRequired"));
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateBusinessCustomer(orgId, customerId, {
          displayName: name,
          companyName,
          email,
          phone,
          address,
          notes,
        });
        navigation.goBack();
      } else {
        const id = await createBusinessCustomer(orgId, {
          displayName: name,
          companyName,
          email,
          phone,
          address,
          notes,
        });
        navigation.replace("BusinessCustomerDetail", { customerId: id });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert(t("common.error"), msg);
    } finally {
      setSaving(false);
    }
  }, [
    activeOrganization?.id,
    address,
    canManageCustomers,
    companyName,
    customerId,
    displayName,
    email,
    isEdit,
    navigation,
    notes,
    phone,
    t,
  ]);

  if (!canManageCustomers) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t("business.customers.noAccess")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.pageTitle}>
          {isEdit ? t("business.customers.edit.titleEdit") : t("business.customers.edit.titleCreate")}
        </Text>

        <Text style={styles.label}>{t("business.customers.edit.displayName")} *</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholderTextColor="rgba(0,0,0,0.35)"
        />

        <Text style={styles.label}>{t("business.customers.edit.companyName")}</Text>
        <TextInput style={styles.input} value={companyName} onChangeText={setCompanyName} />

        <Text style={styles.label}>{t("business.customers.edit.email")}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>{t("business.customers.edit.phone")}</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <Text style={styles.label}>{t("business.customers.edit.address")}</Text>
        <TextInput style={styles.input} value={address} onChangeText={setAddress} />

        <Text style={styles.label}>{t("business.customers.edit.notes")}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => void onSave()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{t("business.customers.edit.save")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#0E1D3A" },
  content: { padding: 16, paddingBottom: 32 },
  centered: { alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.85)", marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 14,
  },
  textArea: { minHeight: 100 },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  muted: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    margin: 24,
  },
});
