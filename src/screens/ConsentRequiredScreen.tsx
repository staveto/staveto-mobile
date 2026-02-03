import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";
import { db } from "../firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, PRIVACY_URL, TERMS_URL } from "../constants/consent";

type Props = {
  onAccepted: () => void;
};

export function ConsentRequiredScreen({ onAccepted }: Props) {
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    if (!user?.id) return;
    if (!checked) {
      setError("Pre pokračovanie je potrebné súhlasiť.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await updateDoc(doc(db, "users", user.id), {
        termsAcceptedAt: serverTimestamp(),
        privacyAcceptedAt: serverTimestamp(),
        termsVersion: CONSENT_TERMS_VERSION,
        privacyVersion: CONSENT_PRIVACY_VERSION,
        consentSource: "gate",
        updatedAt: serverTimestamp(),
      });
      onAccepted();
    } catch (e) {
      setError("Nepodarilo sa uložiť súhlas. Skúste znova.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Súhlas s podmienkami</Text>
      <Text style={styles.subtitle}>
        Pred pokračovaním potrebujeme váš súhlas s podmienkami a zásadami ochrany osobných údajov.
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
          Súhlasím s{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(TERMS_URL)}>
            Podmienkami používania
          </Text>{" "}
          a beriem na vedomie{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            Zásady ochrany osobných údajov (GDPR)
          </Text>
          .
        </Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={accept} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pokračovať</Text>}
      </TouchableOpacity>
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
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});

