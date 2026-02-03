import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getAuthErrorMessage } from "../services/auth";
import { colors, radius, spacing } from "../theme";
import { TERMS_URL, PRIVACY_URL } from "../constants/consent";
import { FirebaseRecaptchaVerifierModal } from "expo-firebase-recaptcha";
import { PhoneAuthProvider } from "firebase/auth";
import { auth, firebaseConfig } from "../firebase";

export function RegisterScreen() {
  const navigation = useNavigation();
  const { t, locale } = useI18n();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState("");
  const recaptchaVerifier = useRef<FirebaseRecaptchaVerifierModal>(null);

  const normalizePhone = (raw: string) => raw.trim().replace(/\s+/g, "");

  const mapPhoneError = (code?: string) => {
    switch (code) {
      case "auth/invalid-phone-number":
        return t("register.phoneInvalid");
      case "auth/too-many-requests":
        return t("register.tooManyRequests");
      case "auth/credential-already-in-use":
      case "auth/phone-number-already-exists":
        return t("register.phoneInUse");
      case "auth/invalid-verification-code":
        return t("register.codeInvalid");
      case "auth/code-expired":
        return t("register.codeExpired");
      default:
        return undefined;
    }
  };

  const onSendCode = async () => {
    const phone = normalizePhone(phoneNumber);
    if (!phone) {
      setError(t("register.phoneRequired"));
      return;
    }
    if (!phone.startsWith("+") || phone.length < 8) {
      setError(t("register.phoneInvalid"));
      return;
    }
    if (!phone.startsWith("+") || phone.length < 8) {
      setError(t("register.phoneInvalid"));
      return;
    }
    setSendingCode(true);
    setError("");
    try {
      const provider = new PhoneAuthProvider(auth);
      const id = await provider.verifyPhoneNumber(phone, recaptchaVerifier.current as FirebaseRecaptchaVerifierModal);
      setVerificationId(id);
      setSmsCode("");
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(mapPhoneError(code) ?? t("register.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  };

  const onRegister = async () => {
    if (!email.trim() || !password) {
      setError(t("register.fillEmailPassword"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("register.passwordsDontMatch"));
      return;
    }
    const phone = normalizePhone(phoneNumber);
    if (!phone) {
      setError(t("register.phoneRequired"));
      return;
    }
    if (!verificationId || !smsCode.trim()) {
      setError(verificationId ? t("register.codeRequired") : t("register.phoneNotVerified"));
      return;
    }
    if (!consentChecked) {
      setConsentError(t("register.consentRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    setConsentError("");
    try {
      const phoneCredential = PhoneAuthProvider.credential(verificationId, smsCode.trim());
      await register(email.trim(), password, displayName.trim() || undefined, {
        phoneNumber: phone,
        phoneCredential,
        locale,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      setError(
        code
          ? mapPhoneError(code) ?? getAuthErrorMessage(code)
          : (e instanceof Error ? e.message : t("register.failed"))
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FirebaseRecaptchaVerifierModal ref={recaptchaVerifier} firebaseConfig={firebaseConfig} />
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
      <Text style={styles.sectionTitle}>{t("register.phoneTitle")}</Text>
      <TextInput
        style={styles.input}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        placeholder={t("register.phonePlaceholder")}
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
      />
      <TouchableOpacity
        style={[styles.button, sendingCode && styles.buttonDisabled]}
        onPress={onSendCode}
        disabled={sendingCode}
      >
        {sendingCode ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("register.sendCode")}</Text>}
      </TouchableOpacity>
      {verificationId ? (
        <TextInput
          style={styles.input}
          value={smsCode}
          onChangeText={setSmsCode}
          placeholder={t("register.smsCodePlaceholder")}
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
        />
      ) : null}
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder={t("register.placeholderPassword")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={true}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={passwordConfirm}
        onChangeText={setPasswordConfirm}
        placeholder={t("register.placeholderPasswordConfirm")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={true}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={styles.consentRow}
        onPress={() => {
          setConsentChecked((v) => !v);
          setConsentError("");
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.consentBox, consentChecked && styles.consentBoxChecked]}>
          {consentChecked ? <Text style={styles.consentCheck}>✓</Text> : null}
        </View>
        <Text style={styles.consentText}>
          {t("register.consentPrefix")}{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(TERMS_URL)}>
            {t("register.consentTerms")}
          </Text>{" "}
          {t("register.consentMiddle")}{" "}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            {t("register.consentPrivacy")}
          </Text>
          .
        </Text>
      </TouchableOpacity>
      {consentError ? <Text style={styles.error}>{consentError}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.button, !consentChecked && styles.buttonDisabled]}
        onPress={onRegister}
        disabled={submitting || !consentChecked}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("register.button")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleBtn} onPress={() => setError(t("register.googleNotAvailable"))}>
        <Text style={styles.googleBtnText}>{t("register.google")}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.link}
        onPress={() => (navigation as { navigate: (name: string) => void }).navigate("Login")}
      >
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
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
  infoBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoText: {
    color: colors.text,
    fontSize: 14,
    textAlign: "center",
  },
  infoTextSmall: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md,
    fontStyle: "italic",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
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
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  consentLink: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
  error: { color: colors.accent, marginBottom: spacing.sm, fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
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
