import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, TextInput } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

type MemberRow = { id: string; name: string; email: string; type: "user" };

export function ProjectMembersScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId, projectName } = (route.params as { projectId?: string; projectName?: string }) ?? {};

  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberQuery, setAddMemberQuery] = useState("");

  const members: MemberRow[] = user
    ? [{ id: user.id, name: user.name ?? user.email ?? "—", email: user.email, type: "user" }]
    : [];

  const goBack = () => navigation.goBack();

  const onAddMember = () => setShowAddMember(true);
  const closeAddMember = () => {
    setShowAddMember(false);
    setAddMemberQuery("");
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("projectMembers.title")}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>
                {(m.name ?? "?")
                  .split(/\s/)
                  .map((s) => s[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "?"}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={styles.memberEmail}>{m.email}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.addMemberBtn} onPress={onAddMember}>
        <Ionicons name="person-add" size={22} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.addMemberBtnText}>{t("projectMembers.addMember")}</Text>
      </TouchableOpacity>

      <Modal visible={showAddMember} transparent animationType="slide">
        <View style={[styles.addMemberOverlay, { paddingTop: insets.top }]}>
          <View style={styles.addMemberContainer}>
            <View style={styles.addMemberHeader}>
              <TouchableOpacity onPress={closeAddMember} style={styles.addMemberClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={26} color={colors.textOnDark} />
              </TouchableOpacity>
              <Text style={styles.addMemberTitle}>{t("addMember.title")}</Text>
              <View style={styles.addMemberHeaderRight} />
            </View>
            <View style={styles.addMemberSearchWrap}>
              <Ionicons name="search" size={20} color={colors.textMuted} style={styles.addMemberSearchIcon} />
              <TextInput
                style={styles.addMemberSearchInput}
                value={addMemberQuery}
                onChangeText={setAddMemberQuery}
                placeholder={t("addMember.searchPlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.addMemberHint}>{t("addMember.hint")}</Text>
            <View style={styles.addMemberResults} />
            <TouchableOpacity style={styles.addMemberDone} onPress={closeAddMember}>
              <Text style={styles.addMemberDoneText}>{t("addMember.done")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBack: { padding: spacing.xs },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "600", color: colors.textOnDark, textAlign: "center" },
  headerRight: { width: 40 },

  content: { flex: 1 },
  contentInner: { padding: spacing.lg, paddingBottom: 100 },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#b366b3",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  memberAvatarText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 16, fontWeight: "600", color: colors.textOnDark },
  memberEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  addMemberBtn: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
  },
  addMemberBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },

  addMemberOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-start",
    paddingHorizontal: spacing.lg,
  },
  addMemberContainer: {
    backgroundColor: colors.background,
    borderRadius: radius,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addMemberHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  addMemberClose: { padding: spacing.xs },
  addMemberTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.textOnDark, textAlign: "center" },
  addMemberHeaderRight: { width: 34 },
  addMemberSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  addMemberSearchIcon: { marginLeft: spacing.md, marginRight: spacing.sm },
  addMemberSearchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  addMemberHint: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg },
  addMemberResults: { minHeight: 120, marginBottom: spacing.lg },
  addMemberDone: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  addMemberDoneText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
