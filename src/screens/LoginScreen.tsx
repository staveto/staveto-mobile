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
  Modal,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getAuthErrorMessage, loginWithApple, loginWithGoogle, sendPasswordResetEmail } from "../services/auth";
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
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

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

  const onForgotPassword = () => {
    setForgotEmail(email.trim());
    setError("");
    setShowForgotPassword(true);
  };

  const onSubmitForgotPassword = async () => {
    const emailToUse = forgotEmail.trim();
    if (!emailToUse || !emailToUse.includes("@")) {
      setError(t("login.forgotEmailRequired"));
      return;
    }
    setForgotSubmitting(true);
    setError("");
    try {
      await sendPasswordResetEmail(emailToUse);
      setShowForgotPassword(false);
      setForgotEmail("");
      Alert.alert(t("login.forgotSuccessTitle"), t("login.forgotSuccessMessage"));
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed")));
    } finally {
      setForgotSubmitting(false);
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

  const onAppleLogin = async () => {
    setSubmitting(true);
    setError("");
    try {
      await loginWithApple();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
      <TouchableOpacity style={styles.forgotLink} onPress={onForgotPassword}>
        <Text style={styles.forgotLinkText}>{t("login.forgotPassword")}</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onLogin} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("login.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={onGoogleLogin} disabled={submitting}>
        <Ionicons name="logo-google" size={20} color="#fff" />
        <Text style={styles.googleBtnText}>{t("register.google")}</Text>
      </TouchableOpacity>
      {Platform.OS === "ios" && (
        <TouchableOpacity style={styles.appleBtn} onPress={onAppleLogin} disabled={submitting}>
          <Ionicons name="logo-apple" size={22} color="#fff" />
          <Text style={styles.appleBtnText}>{t("login.apple")}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.link}
        onPress={() => (navigation as { navigate: (n: string) => void }).navigate("LanguageSelect")}
      >
        <Text style={styles.linkText}>{t("login.noAccount")}</Text>
      </TouchableOpacity>

      <Modal visible={showForgotPassword} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowForgotPassword(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
          <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("login.forgotTitle")}</Text>
            <Text style={styles.modalSubtitle}>{t("login.forgotSubtitle")}</Text>
            <TextInput
              style={styles.input}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              placeholder={t("login.placeholderEmail")}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowForgotPassword(false)}>
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, forgotSubmitting && styles.modalSubmitDisabled]}
                onPress={onSubmitForgotPassword}
                disabled={forgotSubmitting}
              >
                {forgotSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSubmitText}>{t("login.forgotSend")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
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
  forgotLink: {
    marginTop: spacing.xs,
    alignSelf: "flex-end",
  },
  forgotLinkText: {
    color: colors.primary,
    fontSize: 14,
  },
  error: {
    color: colors.accent,
    marginTop: spacing.sm,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  modalButtons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: { fontSize: 16, fontWeight: "600", color: colors.text },
  modalSubmit: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  modalSubmitDisabled: { opacity: 0.6 },
  modalSubmitText: { fontSize: 16, fontWeight: "600", color: "#fff" },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#4285F4",
  },
  googleBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  appleBtn: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#000",
  },
  appleBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.primary, fontSize: 14 },
});
