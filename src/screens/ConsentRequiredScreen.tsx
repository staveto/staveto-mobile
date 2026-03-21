import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import {
  CONSENT_PRIVACY_VERSION,
  CONSENT_TERMS_VERSION,
  PENDING_CONSENT_KEY,
  PRIVACY_URL,
  TERMS_URL,
} from "../constants/consent";

type Props = {
  onAccepted: () => void;
  onBack?: () => void;
};

export function ConsentRequiredScreen({ onAccepted, onBack }: Props) {
  const { locale, t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    if (!checked) {
      setError(t("consent.requiredError") || "Pre pokračovanie je potrebné súhlasiť.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      console.log("CONSENT start");
      const payload = {
        termsAccepted: true,
        privacyAccepted: true,
        acceptedAt: new Date().toISOString(),
        termsVersion: CONSENT_TERMS_VERSION,
        privacyVersion: CONSENT_PRIVACY_VERSION,
        locale,
      };
      const savePromise = AsyncStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(payload));
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 1000)
      );
      const result = await Promise.race([savePromise.then(() => "saved" as const), timeoutPromise]);
      if (result === "saved") {
        console.log("CONSENT saved");
      } else {
        console.warn("CONSENT save timeout");
        savePromise.then(() => console.log("CONSENT saved"));
      }
      onAccepted();
      console.log("CONSENT navigated");
    } catch (e) {
      console.error("CONSENT error", e);
      setError(t("consent.saveFailed") || "Nepodarilo sa uložiť súhlas. Skúste znova.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("consent.title") || "Súhlas s podmienkami"}</Text>
      <Text style={styles.subtitle}>
        {t("consent.subtitle") || "Pred pokračovaním potrebujeme váš súhlas s podmienkami a zásadami ochrany osobných údajov."}
      </Text>

      <TouchableOpacity
        style={styles.consentRow}
        onPress={() => {
          setChecked((v) => !v);
          setError("");
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.consentBox, checked && styles.consentBoxChecked]}>
          {checked ? <Text style={styles.consentCheck}>✓</Text> : null}
        </View>
        <Text style={styles.consentText}>
          {t("consent.checkboxPrefix") || "Súhlasím s"}{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(TERMS_URL)}>
            {t("consent.termsLink") || "Podmienkami používania"}
          </Text>{" "}
          {t("consent.checkboxMiddle") || "a beriem na vedomie"}{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            {t("consent.privacyLink") || "Zásady ochrany osobných údajov (GDPR)"}
          </Text>
          .
        </Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {onBack ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} disabled={submitting}>
            <Text style={styles.secondaryText}>{t("common.back")}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.button, (!checked || submitting) && styles.buttonDisabled, onBack ? styles.buttonFlex : undefined]}
          onPress={accept}
          disabled={!checked || submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("consent.continue") || "Pokračovať"}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    color: colors.textOnDark,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  consentBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    marginTop: 2,
  },
  consentBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  consentCheck: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  consentText: {
    flex: 1,    color: colors.textOnDark,
    fontSize: 13,
    lineHeight: 18,
  },
  consentLink: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
  error: {
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  secondaryBtn: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    flex: 1,
  },
  buttonFlex: { flex: 1 },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});

