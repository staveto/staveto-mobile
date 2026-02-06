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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getAuthErrorMessage, loginWithGoogle } from "../services/auth";
import { colors, radius, spacing } from "../theme";

export function LoginScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onLogin = async () => {
    if (!email.trim() || !password) {
      setError(t("login.failed"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleLogin = async () => {
    setSubmitting(true);
    setError("");
    try {
      await loginWithGoogle();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Image source={require("../../assets/logo.png")} style={styles.logo} resizeMode="contain" accessibilityLabel="Staveto logo" />
      <Text style={styles.title}>{t("login.title")}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder={t("login.placeholderEmail")}
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={[styles.input, { marginTop: spacing.sm }]}
        value={password}
        onChangeText={setPassword}
        placeholder={t("register.placeholderPassword")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={true}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onLogin} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("login.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={onGoogleLogin} disabled={submitting}>
        <Text style={styles.googleBtnText}>{t("register.google")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => (navigation as { navigate: (n: string) => void }).navigate("Register")}>
        <Text style={styles.linkText}>{t("login.noAccount")}</Text>
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
  logo: {
    width: 160,
    height: 80,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 36,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: spacing.md,
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
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    marginTop: spacing.sm,
  },
  passwordInput: {
    flex: 1,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  passwordToggle: {
    padding: spacing.md,
    paddingLeft: spacing.sm,
  },
  error: {
    color: colors.accent,
    marginTop: spacing.sm,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
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
