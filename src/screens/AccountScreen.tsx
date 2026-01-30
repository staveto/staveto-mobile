import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Share,
  Modal,
  Pressable,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getBaseURL, api } from "../api/client";
import { colors, radius, spacing } from "../theme";

function Row({
  icon,
  label,
  onPress,
  right,
}: {
  icon: keyof React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const content = (
    <>
      <Ionicons name={icon} size={22} color={colors.textMuted} style={rowStyles.icon} />
      <Text style={rowStyles.label}>{label}</Text>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null)}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={rowStyles.row} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={rowStyles.row}>{content}</View>;
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  icon: { marginRight: spacing.md, width: 28, textAlign: "center" },
  label: { flex: 1, fontSize: 16, color: colors.text },
});

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const LOCALES = ["sk", "en", "de", "cs"] as const;
type Locale = (typeof LOCALES)[number];

export function AccountScreen() {
  const navigation = useNavigation();
  const { t, locale, setLocale, localeNames } = useI18n();
  const { user, orgId, token, logout } = useAuth();
  const [showAway, setShowAway] = useState(false);
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugMessage, setDebugMessage] = useState("");

  const nav = navigation as { navigate: (name: string) => void };
  const displayName = user?.name ?? user?.email ?? "—";
  const initials = displayName !== "—" ? displayName.slice(0, 2).toUpperCase() : "?";

  const shareEmail = () => {
    const email = user?.email ?? "";
    if (email) Share.share({ message: email, title: t("account.email") });
  };

  const runTest = async (name: string, fn: () => Promise<unknown>) => {
    setDebugMessage(`… ${name}`);
    try {
      const out = await fn();
      setDebugMessage(`${name}: OK\n${JSON.stringify(out, null, 2).slice(0, 400)}`);
    } catch (e) {
      setDebugMessage(`${name}: FAIL\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const appVersion = "1.0.0"; // could use Constants.expoConfig?.version

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profil: avatar + meno + rola/department + email */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.profileName}>{displayName}</Text>
        <Text style={styles.profileHint}>{t("account.addRoleDepartment")}</Text>
        <View style={styles.emailRow}>
          <Text style={styles.emailText} numberOfLines={1}>{user?.email ?? "—"}</Text>
          <TouchableOpacity onPress={shareEmail} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="copy-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Rýchle akcie: Show away, Send message, View tasks */}
      <View style={styles.card}>
        <Row
          icon="car-outline"
          label={t("account.showAway")}
          right={
            <Switch
              value={showAway}
              onValueChange={setShowAway}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          }
        />
        <Row icon="chatbubble-outline" label={t("account.sendMessage")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="checkbox-outline" label={t("account.viewTasks")} onPress={() => nav.navigate("Tasks")} />
      </View>

      {/* Organizácie */}
      <SectionTitle title={t("account.organizations")} />
      <View style={styles.card}>
        <View style={styles.orgRow}>
          <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={{ marginRight: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>staveto.sk</Text>
            <Text style={styles.orgEmail}>{user?.email ?? "—"}</Text>
          </View>
          <TouchableOpacity style={styles.inviteBtn} onPress={() => Alert.alert(t("account.comingSoon"))}>
            <Text style={styles.inviteBtnText}>{t("account.invite")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Plán */}
      <SectionTitle title={t("account.plan")} />
      <View style={styles.card}>
        <View style={styles.planRow}>
          <Ionicons name="calendar-outline" size={22} color={colors.textMuted} style={{ marginRight: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Text style={rowStyles.label}>{t("account.planInfo")}</Text>
            <Text style={styles.planSub}>{t("account.comingSoon")}</Text>
          </View>
          <TouchableOpacity onPress={() => Alert.alert(t("account.comingSoon"))}>
            <Text style={styles.getInfoText}>{t("account.getInfo")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notifikácie */}
      <SectionTitle title={t("account.settings")} />
      <View style={styles.card}>
        <Row
          icon="moon-outline"
          label={t("account.doNotDisturb")}
          right={
            <Switch
              value={doNotDisturb}
              onValueChange={setDoNotDisturb}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          }
        />
        <Row
          icon="notifications-outline"
          label={t("account.pushNotifications")}
          onPress={() => Alert.alert(t("account.manage"), t("account.comingSoon"))}
        />
      </View>

      {/* Podpora */}
      <SectionTitle title={t("account.support")} />
      <View style={styles.card}>
        <Row icon="information-circle-outline" label={t("account.androidGuide")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="help-circle-outline" label={t("account.contactSupport")} onPress={() => Alert.alert(t("account.comingSoon"))} />
      </View>

      {/* App */}
      <SectionTitle title={t("account.app")} />
      <View style={styles.card}>
        <Row icon="moon-outline" label={t("account.displaySetting")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row
          icon="language-outline"
          label={t("account.language")}
          onPress={() => setShowLanguageModal(true)}
          right={<Text style={styles.localeBadge}>{localeNames[locale]}</Text>}
        />
        <Row icon="eye-outline" label={t("account.privacyPolicy")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="document-text-outline" label={t("account.termsOfService")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="list-outline" label={t("account.licenses")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <View style={[rowStyles.row, { borderBottomWidth: 0 }]}>
          <Ionicons name="phone-portrait-outline" size={22} color={colors.textMuted} style={rowStyles.icon} />
          <Text style={rowStyles.label}>{t("account.appVersion")}</Text>
          <Text style={styles.versionNum}>{appVersion}</Text>
        </View>
      </View>

      {/* Debug (skrytý) */}
      <TouchableOpacity onPress={() => setShowDebug((v) => !v)} style={{ marginTop: spacing.sm, padding: spacing.sm }}>
        <Text style={styles.debugToggle}>{showDebug ? t("account.hideDebug") : t("account.debug")}</Text>
      </TouchableOpacity>
      {showDebug && (
        <View style={[styles.card, { borderColor: colors.primary, marginTop: spacing.sm }]}>
          <Text style={styles.debugLine}>baseURL: {getBaseURL()}</Text>
          <Text style={styles.debugLine}>Token: {token ? "áno" : "nie"}</Text>
          <Text style={styles.debugLine}>orgId: {orgId ?? "—"}</Text>
          <View style={styles.debugButtons}>
            <TouchableOpacity style={styles.debugBtn} onPress={() => runTest("/health", () => api.healthCheck())}>
              <Text style={styles.debugBtnText}>Test /health</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, !orgId && styles.debugBtnDisabled]}
              disabled={!orgId}
              onPress={() => runTest("/projects", () => api.getProjects(orgId!))}
            >
              <Text style={styles.debugBtnText}>Test /projects</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, !orgId && styles.debugBtnDisabled]}
              disabled={!orgId}
              onPress={() => runTest("/tasks", () => api.getTasks(orgId!, "today", 0))}
            >
              <Text style={styles.debugBtnText}>Test /tasks</Text>
            </TouchableOpacity>
          </View>
          {debugMessage ? <Text style={styles.debugOutput}>{debugMessage}</Text> : null}
        </View>
      )}

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutBtnText}>{t("account.logout")}</Text>
      </TouchableOpacity>

      <Modal visible={showLanguageModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowLanguageModal(false)} />
          <View style={styles.languageModal}>
            <Text style={styles.languageModalTitle}>{t("account.language")}</Text>
            {LOCALES.map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.languageOption, locale === code && styles.languageOptionActive]}
                onPress={() => {
                  setLocale(code);
                  setShowLanguageModal(false);
                }}
              >
                <Text style={[styles.languageOptionText, locale === code && styles.languageOptionTextActive]}>
                  {localeNames[code]}
                </Text>
                {locale === code ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.languageCancel} onPress={() => setShowLanguageModal(false)}>
              <Text style={styles.languageCancelText}>{t("tasks.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.lg * 3 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E91E63",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 22, fontWeight: "700", color: "#fff" },
  profileName: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: 4 },
  profileHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  emailText: { fontSize: 14, color: colors.textMuted, flex: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  orgName: { fontSize: 16, fontWeight: "600", color: colors.text },
  orgEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  inviteBtn: { backgroundColor: colors.primary, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  inviteBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  planSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  getInfoText: { fontSize: 14, color: colors.primary, fontWeight: "500" },
  versionNum: { fontSize: 14, color: colors.textMuted },
  debugToggle: { fontSize: 12, color: colors.primary },
  debugLine: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  debugButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm },
  debugBtn: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  debugBtnDisabled: { opacity: 0.5 },
  debugBtnText: { color: "#fff", fontSize: 12 },
  debugOutput: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.text,
    backgroundColor: colors.background,
    padding: 8,
    borderRadius: 8,
  },
  logoutBtn: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.accent,
    alignItems: "center",
  },
  logoutBtnText: { color: "#fff", fontWeight: "600" },
  localeBadge: { fontSize: 14, color: colors.textMuted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  languageModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  languageOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    marginBottom: 4,
  },
  languageOptionActive: { backgroundColor: colors.background },
  languageOptionText: { fontSize: 16, color: colors.text },
  languageOptionTextActive: { fontWeight: "600", color: colors.primary },
  languageCancel: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  languageCancelText: { fontSize: 16, color: colors.textMuted },
});
