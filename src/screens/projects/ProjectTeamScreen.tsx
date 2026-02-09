import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useAuth } from "../../context/AuthContext";
import { colors, radius, spacing } from "../../theme";
import * as projectsService from "../../services/projects";
import * as membersService from "../../services/members";
import type { ProjectMemberDoc } from "../../services/members";

type RouteParams = { projectId?: string; projectName?: string };

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0]?.toUpperCase()).join("");
  return initials || "?";
}

export function ProjectTeamScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId, projectName } = (route.params as RouteParams) ?? {};

  const [members, setMembers] = useState<ProjectMemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [emailInput, setEmailInput] = useState("");

  const isOwner = useMemo(() => {
    return !!projectOwnerId && user?.id === projectOwnerId;
  }, [projectOwnerId, user?.id]);

  const loadMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const project = await projectsService.getProject(projectId);
      setProjectOwnerId(project?.ownerId ?? null);
      const list = await membersService.listMembers(projectId);
      setMembers(list);
    } catch (error: any) {
      Alert.alert(
        t("common.error") || "Error",
        error?.message || t("team.loadFailed") || "Failed to load team members."
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useFocusEffect(
    useCallback(() => {
      loadMembers();
    }, [loadMembers])
  );

  const handleAddMember = async () => {
    if (!projectId) return;
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert(
        t("common.error") || "Error",
        t("team.invalidEmail") || "Please enter a valid email."
      );
      return;
    }
    setSubmitting(true);
    try {
      await membersService.addMemberByEmail(projectId, email);
      setEmailInput("");
      setShowAdd(false);
      await loadMembers();
    } catch (error: any) {
      const code = error?.code as string | undefined;
      const fallback = t("team.addFailed") || "Failed to add member.";
      const message =
        code === "not-found"
          ? t("team.notFound") || "User not found."
          : error?.message || fallback;
      Alert.alert(t("common.error") || "Error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async (member: ProjectMemberDoc) => {
    if (!projectId) return;
    Alert.alert(
      t("team.confirmRemoveTitle") || "Remove member",
      t("team.confirmRemoveBody") || "Remove this member from the project?",
      [
        { text: t("common.cancel") || "Cancel", style: "cancel" },
        {
          text: t("team.remove") || "Remove",
          style: "destructive",
          onPress: async () => {
            setSubmitting(true);
            try {
              await membersService.removeMember(projectId, member.userId);
              await loadMembers();
            } catch (error: any) {
              Alert.alert(
                t("common.error") || "Error",
                error?.message || t("team.removeFailed") || "Failed to remove member."
              );
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const title = projectName ? `${t("team.title") || "Team"} • ${projectName}` : t("team.title") || "Team";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {isOwner && (
        <TouchableOpacity style={styles.primaryButton} onPress={() => setShowAdd((s) => !s)}>
          <Text style={styles.primaryButtonText}>
            {showAdd ? t("team.cancelAdd") || "Cancel" : t("team.addMember") || "Add member"}
          </Text>
        </TouchableOpacity>
      )}

      {isOwner && showAdd && (
        <View style={styles.card}>
          <Text style={styles.label}>{t("team.addByEmail") || "Add by email"}</Text>
          <TextInput
            placeholder={t("team.emailPlaceholder") || "member@email.com"}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={emailInput}
            onChangeText={setEmailInput}
          />
          <TouchableOpacity
            style={[styles.primaryButton, submitting ? styles.buttonDisabled : null]}
            onPress={handleAddMember}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.textOnDark} />
            ) : (
              <Text style={styles.primaryButtonText}>{t("team.add") || "Add"}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t("team.loading") || "Loading team..."}</Text>
        </View>
      ) : members.length === 0 ? (
        <Text style={styles.emptyText}>{t("team.noMembers") || "No team members yet."}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {members.map((member) => {
            const name = member.displayName ?? member.emailLower;
            return (
              <View key={member.id} style={styles.memberRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(name)}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{name}</Text>
                  <Text style={styles.memberRole}>{t("team.member") || "Member"}</Text>
                </View>
                {isOwner ? (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleRemoveMember(member)}
                    disabled={submitting}
                  >
                    <Ionicons name="trash-outline" size={20} color="#d64545" />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  backButton: {
    position: "absolute",
    right: 0,
    top: 0,
    padding: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  primaryButtonText: {
    color: colors.textOnDark,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.text,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
    marginBottom: spacing.md,
  },
  loading: {
    alignItems: "center",
    marginTop: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
  },
  emptyText: {
    color: colors.textMuted,
    marginTop: spacing.lg,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  avatarText: {
    color: colors.primary,
    fontWeight: "700",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: colors.text,
    fontWeight: "600",
  },
  memberRole: {
    color: colors.textMuted,
    fontSize: 12,
  },
  removeButton: {
    padding: spacing.xs,
  },
});
