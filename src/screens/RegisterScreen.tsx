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
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getAuth } from "../firebase";
import {
  clearPendingAppleLink,
  getAuthErrorMessage,
  getPendingAppleLinkEmail,
  isAppleSignInAvailable,
  linkAppleToExistingAccount,
  loginWithApple,
  loginWithGoogle,
} from "../services/auth";
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

  const APPLE_TIMEOUT_MS = 30_000;

  const onAppleRegister = async () => {
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
      const msg = code ? getAuthErrorMessage(code) : (e instanceof Error ? e.message : t("register.failed"));
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

  const nav = navigation as { goBack: () => void; canGoBack?: () => boolean };
  const showBack = nav.canGoBack?.() ?? true;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {showBack && (
        <TouchableOpacity style={styles.backButton} onPress={() => nav.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </TouchableOpacity>
      )}
      <Image source={require("../../assets/logo.png")} style={styles.logo} resizeMode="contain" accessibilityLabel="Staveto logo" />
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
      <TouchableOpacity style={styles.button} onPress={onRegister} disabled={submitting || appleSubmitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("register.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={onGoogleRegister} disabled={submitting || appleSubmitting}>
        <Ionicons name="logo-google" size={20} color="#fff" />
        <Text style={styles.googleBtnText}>{t("register.google")}</Text>
      </TouchableOpacity>
      {Platform.OS === "ios" && appleSignInAvailable && (
        <TouchableOpacity style={styles.appleBtn} onPress={onAppleRegister} disabled={submitting || appleSubmitting}>
          {appleSubmitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={22} color="#fff" />
              <Text style={styles.appleBtnText}>{t("register.apple")}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.link} onPress={() => (navigation as any).navigate("Login")}>
        <Text style={styles.linkText}>{t("register.haveAccount")}</Text>
      </TouchableOpacity>

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
                  "Účet s týmto emailom už existuje. Zadajte heslo na prepojenie s Apple."}
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
                      setError(t("register.failed"));
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
                      setError(code ? getAuthErrorMessage(code) : (err instanceof Error ? err.message : t("register.failed")));
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
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: spacing.lg,
  },
  backButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 24,
    left: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    zIndex: 10,
  },
  backText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
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
    color: "#fff",
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
});
