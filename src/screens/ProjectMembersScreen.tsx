import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Share } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import * as projectMembersService from "../services/projectMembers";
import * as projectsService from "../services/projects";
import { getCallable } from "../firebase";
import type { ProjectMemberDoc } from "../services/projectMembers";
import type { ProjectPhaseDoc } from "../services/projects";

export function ProjectMembersScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId, projectName } = (route.params as { projectId?: string; projectName?: string }) ?? {};
  const access = useProjectAccess(projectId ?? "");

  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberName, setAddMemberName] = useState("");
  const [editingMember, setEditingMember] = useState<ProjectMemberDoc | null>(null);
  const [editPermissionLevel, setEditPermissionLevel] = useState<'viewer' | 'editor'>('viewer');
  const [editShareTasks, setEditShareTasks] = useState(true);
  const [editSharePhases, setEditSharePhases] = useState(true);
  const [editShareExpenses, setEditShareExpenses] = useState(false);
  const [editShareDiary, setEditShareDiary] = useState(false);
  const [editShareDocuments, setEditShareDocuments] = useState(false);
  const [editSelectedPhaseIds, setEditSelectedPhaseIds] = useState<string[]>([]);
  const [members, setMembers] = useState<ProjectMemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  
  // Permission level: 'viewer' = read-only, 'editor' = read-write
  const [permissionLevel, setPermissionLevel] = useState<'viewer' | 'editor'>('editor');
  
  // Sharing options
  const [shareTasks, setShareTasks] = useState(true);
  const [sharePhases, setSharePhases] = useState(true);
  const [shareExpenses, setShareExpenses] = useState(false);
  const [shareDiary, setShareDiary] = useState(false);
  const [shareDocuments, setShareDocuments] = useState(false);
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<string[]>([]);

  const goBack = () => navigation.goBack();

  const loadMembers = async (forceRefresh?: boolean) => {
    if (!projectId) return;
    
    setLoading(true);
    try {
      // Load project to get owner
      const project = await projectsService.getProject(projectId);
      if (project) {
        setProjectOwnerId(project.ownerId || null);
      }

      // Load phases (for sharing selection)
      try {
        const phasesList = await projectsService.listProjectPhases(projectId);
        setPhases(phasesList);
      } catch (error: any) {
        console.warn('[ProjectMembersScreen] Could not load phases:', error);
        setPhases([]);
      }

      // Load members (force from server after add/remove to bypass cache)
      const membersList = await projectMembersService.listProjectMembers(projectId, forceRefresh);
      setMembers(membersList);
    } catch (error: any) {
      console.error('[ProjectMembersScreen] Error loading members:', error);
      Alert.alert(t("common.error"), error?.message?.startsWith("errors.") ? t(error.message) : (error?.message || t("projectMembers.loadFailed")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [projectId]);

  const onAddMember = () => {
    // Reset sharing options to defaults
    setPermissionLevel('editor');
    setShareTasks(true);
    setSharePhases(true);
    setShareExpenses(false);
    setShareDiary(false);
    setShareDocuments(false);
    setSelectedPhaseIds([]);
    setShowAddMember(true);
  };
  
  const closeAddMember = () => {
    setShowAddMember(false);
    setAddMemberEmail("");
    setAddMemberName("");
    setPermissionLevel('editor');
    setShareTasks(true);
    setSharePhases(true);
    setShareExpenses(false);
    setShareDiary(false);
    setShareDocuments(false);
    setSelectedPhaseIds([]);
  };

  const handleInviteMember = async () => {
    if (!projectId || !addMemberEmail.trim()) {
      Alert.alert(
        t('common.error') || 'Chyba',
        t('projectMembers.emailRequired') || 'Prosím zadajte emailovú adresu.'
      );
      return;
    }

    if (!addMemberEmail.includes('@')) {
      Alert.alert(
        t('common.error') || 'Chyba',
        t('projectMembers.invalidEmail') || 'Prosím zadajte platnú emailovú adresu.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await projectMembersService.inviteMemberByEmail(
        projectId,
        addMemberEmail.trim(),
        addMemberName.trim() || undefined,
        permissionLevel,
        {
          tasks: shareTasks,
          phases: sharePhases,
          expenses: shareExpenses,
          diary: shareDiary,
          documents: shareDocuments,
        },
        sharePhases ? selectedPhaseIds : []
      );

      const inviterName = user?.name || user?.firstName || user?.email || "";
      const projName = projectName || t("home.selectProject") || "Project";
      const inviteMessage =
        (inviterName ? t("projectMembers.invitedBy", { name: inviterName }) + "\n\n" : "") +
        t("projectMembers.inviteMessageLine1", { projectName: projName }) + "\n" +
        t("projectMembers.inviteMessageLine2", { email: addMemberEmail.trim() });

      Alert.alert(
        t("common.success") || "Úspech",
        t("projectMembers.inviteSuccess", { email: addMemberEmail.trim() }),
        [
          {
            text: t("projectMembers.copyInviteMessage") || "Copy invite message",
            onPress: async () => {
              try {
                const Clipboard = await import("expo-clipboard");
                await Clipboard.setStringAsync(inviteMessage);
                console.log("[ProjectMembersScreen] Invite message copied to clipboard");
                Alert.alert(t("common.success") || "Úspech", t("projectMembers.inviteCopied") || "Skopírované do schránky.");
              } catch (e) {
                console.warn("[ProjectMembersScreen] Clipboard unavailable (Expo Go?), using Share:", e);
                try {
                  await Share.share({ message: inviteMessage, title: t("projectMembers.inviteShareTitle") || "Pozvánka do projektu" });
                } catch (shareErr) {
                  console.error("[ProjectMembersScreen] Share failed:", shareErr);
                  Alert.alert(t("common.error") || "Chyba", t("projectMembers.copyFailed") || "Nepodarilo sa skopírovať.");
                }
              }
            },
          },
          {
            text: "OK",
            onPress: () => {
              closeAddMember();
              loadMembers(true);
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('[ProjectMembersScreen] Error inviting member:', error);
      Alert.alert(
        t('common.error'),
        error?.message?.startsWith("errors.") ? t(error.message) : (error?.message || t('projectMembers.inviteError'))
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openEditMember = (member: ProjectMemberDoc) => {
    setEditingMember(member);
    setEditPermissionLevel((member.permissionLevel as 'viewer' | 'editor') || 'viewer');
    setEditShareTasks(member.sharedItems?.tasks ?? true);
    setEditSharePhases(member.sharedItems?.phases ?? true);
    setEditShareExpenses(member.sharedItems?.expenses ?? false);
    setEditShareDiary(member.sharedItems?.diary ?? false);
    setEditShareDocuments(member.sharedItems?.documents ?? false);
    setEditSelectedPhaseIds(member.sharedPhaseIds ?? []);
  };

  const closeEditMember = () => {
    setEditingMember(null);
  };

  const handleUpdateMemberPermissions = async () => {
    if (!projectId || !editingMember) return;

    setSubmitting(true);
    try {
      await projectMembersService.updateMemberPermissions(
        projectId,
        editingMember.id,
        editPermissionLevel,
        {
          tasks: editShareTasks,
          phases: editSharePhases,
          expenses: editShareExpenses,
          diary: editShareDiary,
          documents: editShareDocuments,
        },
        editSharePhases ? editSelectedPhaseIds : []
      );
      try {
        await getCallable("syncMembersByUidForProject")({ projectId });
      } catch (e) {
        console.warn("[ProjectMembersScreen] syncMembersByUidForProject failed:", e);
      }
      Alert.alert(
        t('common.success') || 'Úspech',
        t('projectMembers.updateSuccess') || 'Oprávnenia boli aktualizované.'
      );
      closeEditMember();
      loadMembers();
    } catch (error: any) {
      const msg = error?.message || String(error);
      const code = error?.code ?? error?.details?.code;
      console.error('[ProjectMembersScreen] Error updating permissions:', { error, code, msg });
      const userMsg = code === 'functions/not-found' || msg?.includes('NOT_FOUND')
        ? t('projectMembers.functionNotDeployed')
        : (msg?.startsWith("errors.") ? t(msg) : (msg || t('projectMembers.updateError')));
      Alert.alert(t('common.error'), userMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = (member: ProjectMemberDoc) => {
    if (!projectId) return;
    
    Alert.alert(
      t('projectMembers.removeConfirm') || 'Odstrániť člena?',
      t('projectMembers.removeConfirmMessage', { name: member.name || member.email || '' }) || `Naozaj chceš odstrániť ${member.name || member.email} z projektu?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('projectMembers.remove') || 'Odstrániť',
          style: 'destructive',
          onPress: async () => {
            try {
              await projectMembersService.removeMember(projectId, member.id, member.userId);
              await loadMembers(true);
              Alert.alert(
                t('common.success') || 'Úspech',
                t('projectMembers.removeSuccess') || 'Člen bol odstránený z projektu.'
              );
            } catch (error: any) {
              console.error('[ProjectMembersScreen] Error removing member:', error);
              Alert.alert(
                t('common.error'),
                error?.message?.startsWith("errors.") ? t(error.message) : (error?.message || t('projectMembers.removeError'))
              );
            }
          },
        },
      ]
    );
  };

  const handleLeaveProject = (member: ProjectMemberDoc) => {
    if (!projectId) return;
    
    Alert.alert(
      t('projectMembers.leaveConfirm') || 'Opustiť projekt?',
      t('projectMembers.leaveConfirmMessage') || 'Naozaj chceš opustiť tento projekt?',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('projectMembers.leaveProject') || 'Opustiť projekt',
          style: 'destructive',
          onPress: async () => {
            try {
              await projectMembersService.removeMember(projectId, member.id, member.userId);
              Alert.alert(
                t('common.success') || 'Úspech',
                t('projectMembers.leaveSuccess') || 'Opustil si projekt.'
              );
              goBack();
            } catch (error: any) {
              console.error('[ProjectMembersScreen] Error leaving project:', error);
              Alert.alert(
                t('common.error') || 'Chyba',
                error.message || t('projectMembers.leaveError')
              );
            }
          },
        },
      ]
    );
  };

  const memberStatusLabel = (member: ProjectMemberDoc): string => {
    const status = (member.status || "").toLowerCase();
    if (status === "invited" || !member.userId) return t("projectMembers.invited") || "Pozvaný";
    return t("projectMembers.active");
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

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {/* Project Owner */}
          {user && projectOwnerId === user.id && (
            <View style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {(user.name ?? user.email ?? "?")
                    .split(/\s/)
                    .map((s) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase() || "?"}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{user.name || user.email || "—"}</Text>
                    <Text style={styles.memberRole}>({t('projectMembers.owner') || 'Vlastník'})</Text>
                  </View>
                <Text style={styles.memberEmail}>{user.email}</Text>
              </View>
            </View>
          )}
          
          {/* Other Members */}
          {members
            .filter(m => m.userId && m.userId !== projectOwnerId)
            .map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.name ?? m.email ?? "?")
                      .split(/\s/)
                      .map((s) => s[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || "?"}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{m.name || m.email || "—"}</Text>
                    <Text style={styles.memberRole}>({memberStatusLabel(m)})</Text>
                  </View>
                  <Text style={styles.memberEmail}>{m.email || (t('projectMembers.waitingForLogin') || 'Čaká na prihlásenie')}</Text>
                  {m.permissionLevel && (
                    <Text style={styles.memberPermission}>
                      {m.permissionLevel === 'viewer' 
                        ? (t('projectMembers.viewer') || 'Len čítanie')
                        : (t('projectMembers.editor') || 'Úprava')}
                    </Text>
                  )}
                  {m.sharedItems && (
                    <View style={styles.sharedItemsContainer}>
                      {m.sharedItems.tasks && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareTasks') || 'Úlohy'}</Text>
                      )}
                      {m.sharedItems.phases && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.sharePhases') || 'Fázy'}</Text>
                      )}
                      {m.sharedItems.expenses && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareExpenses')}</Text>
                      )}
                      {m.sharedItems.diary && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareDiary') || 'Denník'}</Text>
                      )}
                      {m.sharedItems.documents && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareDocuments') || 'Dokumenty'}</Text>
                      )}
                    </View>
                  )}
                </View>
                {(access.isOwner || access.permissionLevel === "editor") ? (
                  <View style={styles.memberActions}>
                    {access.isOwner && (
                      <TouchableOpacity
                        style={styles.editMemberButton}
                        onPress={() => openEditMember(m)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="create-outline" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.removeMemberButton}
                      onPress={() => handleRemoveMember(m)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : m.userId === user?.id ? (
                  <TouchableOpacity
                    style={styles.leaveProjectButton}
                    onPress={() => handleLeaveProject(m)}
                  >
                    <Text style={styles.leaveProjectButtonText}>
                      {t('projectMembers.leaveProject') || 'Opustiť projekt'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          
          {/* Invited members (without userId) */}
          {members
            .filter(m => !m.userId || m.userId === '')
            .map((m) => (
              <View key={m.id} style={[styles.memberRow, styles.invitedMemberRow]}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.name ?? m.email ?? "?")
                      .split(/\s/)
                      .map((s) => s[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || "?"}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{m.name || m.email || "—"}</Text>
                    <Text style={styles.memberRole}>({memberStatusLabel(m)})</Text>
                  </View>
                  <Text style={styles.memberEmail}>{m.email || (t('projectMembers.waitingForLogin') || 'Čaká na prihlásenie')}</Text>
                  {m.permissionLevel && (
                    <Text style={styles.memberPermission}>
                      {m.permissionLevel === 'viewer' 
                        ? (t('projectMembers.viewer') || 'Len čítanie')
                        : (t('projectMembers.editor') || 'Úprava')}
                    </Text>
                  )}
                  {m.sharedItems && (
                    <View style={styles.sharedItemsContainer}>
                      {m.sharedItems.tasks && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareTasks') || 'Úlohy'}</Text>
                      )}
                      {m.sharedItems.phases && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.sharePhases') || 'Fázy'}</Text>
                      )}
                      {m.sharedItems.expenses && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareExpenses')}</Text>
                      )}
                      {m.sharedItems.diary && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareDiary') || 'Denník'}</Text>
                      )}
                      {m.sharedItems.documents && (
                        <Text style={styles.sharedItemTag}>{t('projectMembers.shareDocuments') || 'Dokumenty'}</Text>
                      )}
                    </View>
                  )}
                </View>
                {(access.isOwner || access.permissionLevel === "editor") && (
                  <View style={styles.memberActions}>
                    {access.isOwner && (
                      <TouchableOpacity
                        style={styles.editMemberButton}
                        onPress={() => openEditMember(m)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="create-outline" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.removeMemberButton}
                      onPress={() => handleRemoveMember(m)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          {access.isOwner && projectId && (
            <TouchableOpacity
              style={styles.syncPermissionsBtn}
              onPress={async () => {
                try {
                  await getCallable("syncMembersByUidForProject")({ projectId });
                  Alert.alert(t("common.success") || "Úspech", t("projectMembers.syncSuccess") || "Oprávnenia boli synchronizované.");
                  loadMembers(true);
                } catch (e: any) {
                  Alert.alert(t("common.error"), e?.message ?? (t("projectMembers.syncFailed") || "Synchronizácia zlyhala."));
                }
              }}
            >
              <Ionicons name="sync-outline" size={18} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.syncPermissionsText}>{t("projectMembers.syncPermissions") || "Synchronizovať oprávnenia"}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.addMemberBtn} onPress={onAddMember}>
        <Ionicons name="person-add" size={22} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.addMemberBtnText}>{t("projectMembers.addMember")}</Text>
      </TouchableOpacity>

      <Modal visible={showAddMember} transparent animationType="slide">
        <View style={[styles.addMemberOverlay, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.addMemberContainer}>
            <View style={styles.addMemberHeader}>
              <TouchableOpacity onPress={closeAddMember} style={styles.addMemberClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={26} color={colors.textOnDark} />
              </TouchableOpacity>
              <Text style={styles.addMemberTitle}>{t("addMember.title")}</Text>
              <View style={styles.addMemberHeaderRight} />
            </View>
            <ScrollView
              style={styles.addMemberScroll}
              contentContainerStyle={styles.addMemberScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
            <Text style={styles.addMemberLabel}>{t('projectMembers.emailLabel') || 'Email *'}</Text>
            <TextInput
              style={styles.addMemberInput}
              value={addMemberEmail}
              onChangeText={setAddMemberEmail}
              placeholder={t('projectMembers.emailPlaceholder') || 'email@priklad.sk'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            
            <Text style={styles.addMemberLabel}>{t('projectMembers.nameLabel') || 'Meno (voliteľné)'}</Text>
            <TextInput
              style={styles.addMemberInput}
              value={addMemberName}
              onChangeText={setAddMemberName}
              placeholder={t('projectMembers.namePlaceholder') || 'Meno priezvisko'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
            
            <Text style={styles.addMemberSectionTitle}>
              {t('projectMembers.permissionLevel') || 'Úroveň oprávnení'}
            </Text>
            
            {/* Permission level selector */}
            <View style={styles.permissionLevelContainer}>
              <TouchableOpacity
                style={[styles.permissionOption, permissionLevel === 'viewer' && styles.permissionOptionActive]}
                onPress={() => setPermissionLevel('viewer')}
                activeOpacity={0.7}
              >
                <Ionicons 
                  name={permissionLevel === 'viewer' ? 'radio-button-on' : 'radio-button-off'} 
                  size={20} 
                  color={permissionLevel === 'viewer' ? colors.primary : colors.textMuted} 
                />
                <View style={styles.permissionOptionContent}>
                  <Text style={[styles.permissionOptionLabel, permissionLevel === 'viewer' && styles.permissionOptionLabelActive]}>
                    {t('projectMembers.viewer') || 'Len čítanie'}
                  </Text>
                  <Text style={styles.permissionOptionDescription}>
                    {t('projectMembers.viewerDescription') || 'Môže len zobrazovať obsah, nemôže upravovať'}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.permissionOption, permissionLevel === 'editor' && styles.permissionOptionActive]}
                onPress={() => setPermissionLevel('editor')}
                activeOpacity={0.7}
              >
                <Ionicons 
                  name={permissionLevel === 'editor' ? 'radio-button-on' : 'radio-button-off'} 
                  size={20} 
                  color={permissionLevel === 'editor' ? colors.primary : colors.textMuted} 
                />
                <View style={styles.permissionOptionContent}>
                  <Text style={[styles.permissionOptionLabel, permissionLevel === 'editor' && styles.permissionOptionLabelActive]}>
                    {t('projectMembers.editor') || 'Úprava'}
                  </Text>
                  <Text style={styles.permissionOptionDescription}>
                    {t('projectMembers.editorDescription') || 'Môže zobrazovať aj upravovať obsah'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <Text style={styles.addMemberSectionTitle}>
              {t('projectMembers.shareWhat') || 'Čo chceš zdieľať?'}
            </Text>
            
            {/* Sharing checkboxes */}
            <View style={styles.shareOptionsContainer}>
              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => setShareTasks(!shareTasks)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, shareTasks && styles.checkboxChecked]}>
                  {shareTasks && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.shareOptionLabel}>
                  {t('projectMembers.shareTasks') || 'Úlohy'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => setSharePhases(!sharePhases)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, sharePhases && styles.checkboxChecked]}>
                  {sharePhases && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.shareOptionLabel}>
                  {t('projectMembers.sharePhases') || 'Fázy'}
                </Text>
              </TouchableOpacity>

              {sharePhases && phases.length > 0 && (
                <View style={styles.phaseSelectionContainer}>
                  <Text style={styles.phaseSelectionLabel}>
                    {t('projectMembers.selectPhases') || 'Vyber konkrétne fázy (voliteľné):'}
                  </Text>
                  <ScrollView style={styles.phaseSelectionList} nestedScrollEnabled>
                    {phases.map((phase) => {
                      const isSelected = selectedPhaseIds.includes(phase.id);
                      return (
                        <TouchableOpacity
                          key={phase.id}
                          style={styles.phaseOption}
                          onPress={() => {
                            if (isSelected) {
                              setSelectedPhaseIds(selectedPhaseIds.filter(id => id !== phase.id));
                            } else {
                              setSelectedPhaseIds([...selectedPhaseIds, phase.id]);
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.checkbox, styles.checkboxSmall, isSelected && styles.checkboxChecked]}>
                            {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                          <Text style={styles.phaseOptionLabel}>{phase.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => setShareExpenses(!shareExpenses)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, shareExpenses && styles.checkboxChecked]}>
                  {shareExpenses && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.shareOptionLabel}>
                  {t('projectMembers.shareExpenses')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => setShareDiary(!shareDiary)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, shareDiary && styles.checkboxChecked]}>
                  {shareDiary && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.shareOptionLabel}>
                  {t('projectMembers.shareDiary') || 'Denník stavby'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => setShareDocuments(!shareDocuments)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, shareDocuments && styles.checkboxChecked]}>
                  {shareDocuments && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.shareOptionLabel}>
                  {t('projectMembers.shareDocuments') || 'Dokumenty'}
                </Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.addMemberHint}>
              {t('projectMembers.inviteHint') || 'Pozvaný používateľ bude môcť pristúpiť k vybraným častiam projektu po prihlásení do aplikácie s týmto emailom.'}
            </Text>
            
            <View style={styles.addMemberButtons}>
              <TouchableOpacity 
                style={styles.addMemberCancel} 
                onPress={closeAddMember}
                disabled={submitting}
              >
                <Text style={styles.addMemberCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.addMemberInvite, submitting && styles.addMemberInviteDisabled]} 
                onPress={handleInviteMember}
                disabled={submitting || !addMemberEmail.trim()}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addMemberInviteText}>{t('account.invite') || 'Pozvať'}</Text>
                )}
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit member permissions modal */}
      <Modal visible={!!editingMember} transparent animationType="slide">
        <View style={[styles.addMemberOverlay, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.addMemberContainer}>
            <View style={styles.addMemberHeader}>
              <TouchableOpacity onPress={closeEditMember} style={styles.addMemberClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={26} color={colors.textOnDark} />
              </TouchableOpacity>
              <Text style={styles.addMemberTitle}>
                {t('projectMembers.editMember') || 'Upraviť oprávnenia'} – {editingMember?.name || editingMember?.email || '—'}
              </Text>
              <View style={styles.addMemberHeaderRight} />
            </View>
            <ScrollView
              style={styles.addMemberScroll}
              contentContainerStyle={styles.addMemberScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <Text style={styles.addMemberSectionTitle}>
                {t('projectMembers.permissionLevel') || 'Úroveň oprávnení'}
              </Text>

              <View style={styles.permissionLevelContainer}>
                <TouchableOpacity
                  style={[styles.permissionOption, editPermissionLevel === 'viewer' && styles.permissionOptionActive]}
                  onPress={() => setEditPermissionLevel('viewer')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={editPermissionLevel === 'viewer' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={editPermissionLevel === 'viewer' ? colors.primary : colors.textMuted}
                  />
                  <View style={styles.permissionOptionContent}>
                    <Text style={[styles.permissionOptionLabel, editPermissionLevel === 'viewer' && styles.permissionOptionLabelActive]}>
                      {t('projectMembers.viewer') || 'Len čítanie'}
                    </Text>
                    <Text style={styles.permissionOptionDescription}>
                      {t('projectMembers.viewerDescription') || 'Môže len zobrazovať obsah, nemôže upravovať'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.permissionOption, editPermissionLevel === 'editor' && styles.permissionOptionActive]}
                  onPress={() => setEditPermissionLevel('editor')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={editPermissionLevel === 'editor' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={editPermissionLevel === 'editor' ? colors.primary : colors.textMuted}
                  />
                  <View style={styles.permissionOptionContent}>
                    <Text style={[styles.permissionOptionLabel, editPermissionLevel === 'editor' && styles.permissionOptionLabelActive]}>
                      {t('projectMembers.editor') || 'Úprava'}
                    </Text>
                    <Text style={styles.permissionOptionDescription}>
                      {t('projectMembers.editorDescription') || 'Môže zobrazovať aj upravovať obsah'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <Text style={styles.addMemberSectionTitle}>
                {t('projectMembers.shareWhat') || 'Čo chceš zdieľať?'}
              </Text>

              <View style={styles.shareOptionsContainer}>
                <TouchableOpacity
                  style={styles.shareOption}
                  onPress={() => setEditShareTasks(!editShareTasks)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, editShareTasks && styles.checkboxChecked]}>
                    {editShareTasks && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.shareOptionLabel}>{t('projectMembers.shareTasks') || 'Úlohy'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shareOption}
                  onPress={() => setEditSharePhases(!editSharePhases)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, editSharePhases && styles.checkboxChecked]}>
                    {editSharePhases && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.shareOptionLabel}>{t('projectMembers.sharePhases') || 'Fázy'}</Text>
                </TouchableOpacity>

                {editSharePhases && phases.length > 0 && (
                  <View style={styles.phaseSelectionContainer}>
                    <Text style={styles.phaseSelectionLabel}>
                      {t('projectMembers.selectPhases') || 'Vyber konkrétne fázy (voliteľné):'}
                    </Text>
                    <ScrollView style={styles.phaseSelectionList} nestedScrollEnabled>
                      {phases.map((phase) => {
                        const isSelected = editSelectedPhaseIds.includes(phase.id);
                        return (
                          <TouchableOpacity
                            key={phase.id}
                            style={styles.phaseOption}
                            onPress={() => {
                              if (isSelected) {
                                setEditSelectedPhaseIds(editSelectedPhaseIds.filter(id => id !== phase.id));
                              } else {
                                setEditSelectedPhaseIds([...editSelectedPhaseIds, phase.id]);
                              }
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={[styles.checkbox, styles.checkboxSmall, isSelected && styles.checkboxChecked]}>
                              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                            </View>
                            <Text style={styles.phaseOptionLabel}>{phase.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.shareOption}
                  onPress={() => setEditShareExpenses(!editShareExpenses)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, editShareExpenses && styles.checkboxChecked]}>
                    {editShareExpenses && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.shareOptionLabel}>{t('projectMembers.shareExpenses')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shareOption}
                  onPress={() => setEditShareDiary(!editShareDiary)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, editShareDiary && styles.checkboxChecked]}>
                    {editShareDiary && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.shareOptionLabel}>{t('projectMembers.shareDiary') || 'Denník stavby'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shareOption}
                  onPress={() => setEditShareDocuments(!editShareDocuments)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, editShareDocuments && styles.checkboxChecked]}>
                    {editShareDocuments && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.shareOptionLabel}>{t('projectMembers.shareDocuments') || 'Dokumenty'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.addMemberButtons}>
                <TouchableOpacity
                  style={styles.addMemberCancel}
                  onPress={closeEditMember}
                  disabled={submitting}
                >
                  <Text style={styles.addMemberCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addMemberInvite, (submitting || !user) && styles.addMemberInviteDisabled]}
                  onPress={handleUpdateMemberPermissions}
                  disabled={submitting || !user}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.addMemberInviteText}>{t('projectMembers.savePermissions') || 'Uložiť'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
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

  syncPermissionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius,
  },
  syncPermissionsText: { fontSize: 14, color: colors.primary, fontWeight: "500" },

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
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addMemberScroll: {
    flex: 1,
  },
  addMemberScrollContent: {
    paddingBottom: spacing.md,
  },
  addMemberHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  addMemberClose: { padding: spacing.xs },
  addMemberTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.textOnDark, textAlign: "center" },
  addMemberHeaderRight: { width: 34 },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  addMemberLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  addMemberInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  addMemberSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  shareOptionsContainer: {
    marginBottom: spacing.md,
  },
  shareOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxSmall: {
    width: 20,
    height: 20,
  },
  shareOptionLabel: {
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  phaseSelectionContainer: {
    marginLeft: spacing.xl,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  phaseSelectionLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  phaseSelectionList: {
    maxHeight: 120,
  },
  phaseOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  phaseOptionLabel: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  addMemberHint: { 
    fontSize: 13, 
    color: colors.textMuted, 
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  addMemberButtons: {
    flexDirection: "row",
    gap: spacing.md,
  },
  addMemberCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  addMemberCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  addMemberInvite: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  addMemberInviteDisabled: {
    opacity: 0.5,
  },
  addMemberInviteText: { 
    fontSize: 16, 
    fontWeight: "600", 
    color: "#fff" 
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  memberRole: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  invitedMemberRow: {
    opacity: 0.7,
  },
  memberActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  editMemberButton: {
    padding: spacing.xs,
  },
  removeMemberButton: {
    padding: spacing.xs,
  },
  leaveProjectButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.error + "15",
  },
  leaveProjectButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.error,
  },
  sharedItemsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  sharedItemTag: {
    fontSize: 11,
    color: colors.primary,
    backgroundColor: colors.primary + "15",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  permissionLevelContainer: {
    marginBottom: spacing.lg,
  },
  permissionOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
  },
  permissionOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  permissionOptionContent: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  permissionOptionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  permissionOptionLabelActive: {
    color: colors.primary,
  },
  permissionOptionDescription: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  memberPermission: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "500",
    marginTop: spacing.xs,
  },
});
