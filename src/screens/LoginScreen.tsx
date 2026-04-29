import React, { useState, useEffect } from "react";
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
import { getAuth } from "../firebase";
import {
  clearPendingAppleLink,
  getAuthErrorCodeFromUnknown,
  getAuthErrorMessage,
  getPendingAppleLinkEmail,
  isAppleSignInAvailable,
  linkAppleToExistingAccount,
  loginWithApple,
  loginWithGoogle,
  sendPasswordResetEmail,
} from "../services/auth";
import { colors, radius, spacing } from "../theme";

export function LoginScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { login, resetIntroOnboarding } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [appleSubmitting, setAppleSubmitting] = useState(false);
  const [showAppleLinkModal, setShowAppleLinkModal] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleSignInAvailable().then(setAppleSignInAvailable);
    }
  }, []);

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
      const code = getAuthErrorCodeFromUnknown(e);
      setError(code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  const APPLE_TIMEOUT_MS = 30_000;

  const onAppleLogin = async () => {
    setAppleSubmitting(true);
    setError("");
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error("Apple sign-in timed out.") as Error & { code?: string };
        err.code = "auth/apple-timeout";
        reject(err);
      }, APPLE_TIMEOUT_MS);
    });

    try {
      await Promise.race([loginWithApple(), timeoutPromise]);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "auth/cancelled") return;
      if (code === "auth/account-exists-with-different-credential") {
        setLinkEmail(getPendingAppleLinkEmail() || "");
        setLinkPassword("");
        setShowAppleLinkModal(true);
        return;
      }
      if (__DEV__) {
        console.error("[APPLE_LOGIN_DEBUG]", (e as { code?: string })?.code, (e as { message?: string })?.message, (e as { stack?: string })?.stack);
      }
      const currentUser = getAuth()?.currentUser;
      if (currentUser) {
        return;
      }
      const msg = code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("login.failed"));
      setError(msg);
      Alert.alert(
        t("common.error"),
        `${msg}\n\nContact support with code: APPLE_LOGIN_FAILED`,
        [{ text: t("common.ok") }]
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setAppleSubmitting(false);
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
      <View style={styles.passwordContainer}>
        <TextInput
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          placeholder={t("register.placeholderPassword")}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowPassword((v) => !v)} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
          <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.forgotLink} onPress={onForgotPassword}>
        <Text style={styles.forgotLinkText}>{t("login.forgotPassword")}</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onLogin} disabled={submitting || appleSubmitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("login.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={onGoogleLogin} disabled={submitting || appleSubmitting}>
        <Ionicons name="logo-google" size={20} color={colors.text} />
        <Text style={styles.googleBtnText}>{t("login.google")}</Text>
      </TouchableOpacity>
      {Platform.OS === "ios" && appleSignInAvailable && (
        <TouchableOpacity style={styles.appleBtn} onPress={onAppleLogin} disabled={submitting || appleSubmitting}>
          {appleSubmitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={22} color="#fff" />
              <Text style={styles.appleBtnText}>{t("login.apple")}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.link}
        onPress={() => (navigation as { navigate: (n: string) => void }).navigate("Register")}
      >
        <Text style={styles.linkText}>{t("login.noAccount")}</Text>
      </TouchableOpacity>
      {__DEV__ ? (
        <TouchableOpacity
          style={styles.devIntroReset}
          onPress={() => {
            void resetIntroOnboarding();
          }}
          accessibilityLabel="Reset onboarding intro (dev)"
        >
          <Text style={styles.devIntroResetText}>Dev: znova úvodný onboarding</Text>
        </TouchableOpacity>
      ) : null}

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

      <Modal visible={showAppleLinkModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            clearPendingAppleLink();
            setShowAppleLinkModal(false);
          }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
            <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>
                {t("login.appleLinkTitle") || "Prepojiť s existujúcim účtom"}
              </Text>
              <Text style={styles.modalSubtitle}>
                {t("login.appleLinkSubtitle") ||
                  "Účet s týmto emailom už existuje (napr. cez Google). Zadajte heslo na prepojenie s Apple."}
              </Text>
              <TextInput
                style={[styles.input, { marginBottom: spacing.sm }]}
                value={linkEmail}
                onChangeText={setLinkEmail}
                placeholder={t("login.placeholderEmail")}
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={linkPassword}
                onChangeText={setLinkPassword}
                placeholder={t("register.placeholderPassword")}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => {
                    clearPendingAppleLink();
                    setShowAppleLinkModal(false);
                  }}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalSubmit, linkSubmitting && styles.modalSubmitDisabled]}
                  onPress={async () => {
                    if (!linkEmail.trim() || !linkPassword) {
                      setError(t("login.failed"));
                      return;
                    }
                    setLinkSubmitting(true);
                    setError("");
                    try {
                      await linkAppleToExistingAccount(linkEmail.trim(), linkPassword);
                      setShowAppleLinkModal(false);
                      setLinkEmail("");
                      setLinkPassword("");
                    } catch (err: unknown) {
                      const code = (err as { code?: string })?.code;
                      setError(code ? getAuthErrorMessage(code) : (err instanceof Error ? err.message : t("login.failed")));
                    } finally {
                      setLinkSubmitting(false);
                    }
                  }}
                  disabled={linkSubmitting}
                >
                  {linkSubmitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.modalSubmitText}>
                      {t("login.appleLinkButton") || "Prepojiť"}
                    </Text>
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
    backgroundColor: "#ffffff",
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
    fontSize: 28,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: spacing.md,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: "#eef2f7",
    borderWidth: 2,
    borderColor: "rgba(17, 17, 17, 0.28)",
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eef2f7",
    borderWidth: 2,
    borderColor: "rgba(17, 17, 17, 0.28)",
    borderRadius: radius,
    marginTop: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
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
    color: colors.error,
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
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "rgba(17, 17, 17, 0.2)",
  },
  googleBtnText: { color: colors.text, fontSize: 16, fontWeight: "600" },
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
  devIntroReset: {
    marginTop: spacing.md,
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  devIntroResetText: {
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: "underline",
  },
  linkText: { color: colors.primary, fontSize: 14 },
});
