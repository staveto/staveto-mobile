import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getAuthErrorMessage, loginWithGoogle } from "../services/auth";
import { colors, radius, spacing } from "../theme";

export function RegisterScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onRegister = async () => {
    if (!email.trim() || !password) {
      setError(t("register.fillEmailPassword"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("register.passwordsDontMatch"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await register(email.trim(), password, displayName.trim() || undefined);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("register.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleRegister = async () => {
    setSubmitting(true);
    setError("");
    try {
      await loginWithGoogle();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("register.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>{t("register.title")}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder={t("register.placeholderEmail")}
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t("register.placeholderName")}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder={t("register.placeholderPassword")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        value={passwordConfirm}
        onChangeText={setPasswordConfirm}
        placeholder={t("register.placeholderPasswordConfirm")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onRegister} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("register.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={onGoogleRegister} disabled={submitting}>
        <Text style={styles.googleBtnText}>{t("register.google")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => (navigation as any).navigate("Login")}>
        <Text style={styles.linkText}>{t("register.haveAccount")}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  error: { color: colors.accent, marginBottom: spacing.sm, fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  googleBtn: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  googleBtnText: { color: colors.text },
  link: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.primary, fontSize: 14 },
});
