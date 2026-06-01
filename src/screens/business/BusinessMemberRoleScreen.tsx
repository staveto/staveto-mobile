import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import {
  getOrgMemberByDocId,
  listMembers,
  updateBusinessMemberRole,
  type MembershipDoc,
} from "../../services/businessMembers";
import type { OrgRole } from "../../services/organizations";
import {
  BUSINESS_PERMISSION_KEYS,
  PERMISSION_SECTIONS,
  getEffectivePermissions,
  getRolePreset,
  resetPermissionsToRolePreset,
  type BusinessPermissionKey,
  type BusinessPermissions,
} from "../../lib/businessRolePermissions";
import { colors } from "../../theme";

const ALL_ROLES: OrgRole[] = ["owner", "admin", "manager", "worker", "viewer"];

type RouteParams = {
  orgId: string;
  memberDocId: string;
};

function getMemberName(member: MembershipDoc): string {
  const displayName = ((member as { displayName?: string }).displayName ?? "").trim();
  if (displayName) return displayName;
  const email = ((member as { email?: string; emailLower?: string }).email ?? member.emailLower ?? "").trim();
  if (email) return email;
  return member.userId || member.id;
}

function memberStatusBadgeLabel(t: (key: string, params?: Record<string, string>) => string, status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return t("business.dashboard.statusActive");
  if (s === "suspended") return t("business.dashboard.statusSuspended");
  if (s === "pending" || s === "invited") return t("business.dashboard.statusPending");
  return t("business.dashboard.statusLabel", { status: status.toUpperCase() });
}

function normalizeFunctionsErrorCode(code: unknown): string {
  if (typeof code !== "string") return "";
  return code.replace(/^functions\//, "").trim().toLowerCase();
}

function mapRoleUpdateError(t: (k: string) => string, error: unknown): string {
  const code = normalizeFunctionsErrorCode((error as { code?: string })?.code);
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (code === "failed-precondition" && msg.includes("last active owner")) {
    return t("business.team.roleManagement.lastOwnerCannotBeChanged");
  }
  if (code === "failed-precondition" && msg.includes("owner permissions")) {
    return t("business.team.roleManagement.ownerPermissionsLocked");
  }
  if (code === "permission-denied") {
    if (msg.includes("only an owner can assign") || msg.includes("owner role")) {
      return t("business.team.roleManagement.onlyOwnerCanAssignOwner");
    }
    return t("business.team.roleManagement.ownerProtected");
  }
  if (error instanceof Error && error.message) return error.message;
  return t("common.error");
}

function permissionsEqual(a: BusinessPermissions, b: BusinessPermissions): boolean {
  return BUSINESS_PERMISSION_KEYS.every((key) => a[key] === b[key]);
}

export function BusinessMemberRoleScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { activeMembership } = useActiveOrg();
  const params = (route.params ?? {}) as Partial<RouteParams>;
  const orgId = typeof params.orgId === "string" ? params.orgId : "";
  const memberDocId = typeof params.memberDocId === "string" ? params.memberDocId : "";

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<MembershipDoc | null>(null);
  const [activeOwnerCount, setActiveOwnerCount] = useState(0);
  const [selectedRole, setSelectedRole] = useState<OrgRole | null>(null);
  const [permissions, setPermissions] = useState<BusinessPermissions | null>(null);
  const [saving, setSaving] = useState(false);

  const actorRole = activeMembership?.role ?? "viewer";
  const isActorOwner = actorRole === "owner";
  const isActorAdmin = actorRole === "admin";

  const load = useCallback(async () => {
    if (!orgId || !memberDocId) {
      setMember(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [m, all] = await Promise.all([
        getOrgMemberByDocId(orgId, memberDocId),
        listMembers(orgId),
      ]);
      setMember(m);
      const owners = all.filter(
        (row) => row.role === "owner" && row.status.toLowerCase() === "active"
      ).length;
      setActiveOwnerCount(owners);
      if (m) {
        setSelectedRole(m.role);
        setPermissions(getEffectivePermissions(m.role, m.permissions));
      }
    } catch (e) {
      console.warn("[BusinessMemberRoleScreen] load failed", e);
      setMember(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, memberDocId]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("business.team.roleManagement.title"),
    });
  }, [navigation, t]);

  const targetRole = member?.role ?? "viewer";
  const targetStatus = (member?.status ?? "").toLowerCase();

  const readOnly = useMemo(() => {
    if (!member) return true;
    return targetRole === "owner" && !isActorOwner;
  }, [member, targetRole, isActorOwner]);

  const soleActiveOwnerLocked = useMemo(() => {
    if (!member) return false;
    if (targetRole !== "owner" || targetStatus !== "active") return false;
    return activeOwnerCount <= 1;
  }, [member, targetRole, targetStatus, activeOwnerCount]);

  const canEdit = !readOnly && !soleActiveOwnerLocked && (isActorOwner || isActorAdmin);
  const permissionsLocked = selectedRole === "owner";

  const rolePreset = useMemo(
    () => (selectedRole ? getRolePreset(selectedRole) : null),
    [selectedRole]
  );

  const isDirty = useMemo(() => {
    if (!member || selectedRole == null || !permissions) return false;
    if (selectedRole !== member.role) return true;
    const baseline = getEffectivePermissions(member.role, member.permissions);
    return !permissionsEqual(permissions, baseline);
  }, [member, permissions, selectedRole]);

  const onSelectRole = (role: OrgRole) => {
    setSelectedRole(role);
    setPermissions(resetPermissionsToRolePreset(role));
  };

  const onTogglePermission = (key: BusinessPermissionKey, value: boolean) => {
    if (!permissions || permissionsLocked || !canEdit) return;
    setPermissions({ ...permissions, [key]: value });
  };

  const onResetDefaults = () => {
    if (!selectedRole || !canEdit) return;
    setPermissions(resetPermissionsToRolePreset(selectedRole));
  };

  const onSave = async () => {
    if (!orgId || !memberDocId || !member || selectedRole == null || !permissions || !canEdit) return;
    if (!isDirty) {
      navigation.goBack();
      return;
    }
    setSaving(true);
    try {
      const payload: Parameters<typeof updateBusinessMemberRole>[0] = {
        orgId,
        memberUid: memberDocId,
        role: selectedRole,
      };
      if (selectedRole !== "owner") {
        payload.permissions = { ...permissions };
      }
      await updateBusinessMemberRole(payload);
      await load();
      Alert.alert("", t("business.team.roleManagement.saved"), [
        { text: t("common.ok"), onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert(t("common.error"), mapRoleUpdateError(t, error));
    } finally {
      setSaving(false);
    }
  };

  if (!orgId || !memberDocId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("common.error")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!member || selectedRole == null || !permissions) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("common.error")}</Text>
      </View>
    );
  }

  const name = getMemberName(member);
  const badgeText = memberStatusBadgeLabel(t, member.status);
  const showCustomHint =
    selectedRole !== "owner" &&
    rolePreset != null &&
    !permissionsEqual(permissions, rolePreset);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>{t("business.team.roleManagement.subtitle")}</Text>

      <View style={styles.card}>
        <Text style={styles.name}>{name}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
        <Text style={styles.label}>{t("business.team.roleManagement.currentRole")}</Text>
        <Text style={styles.currentRole}>
          {t(`business.dashboard.teamLicenses.role.${member.role}`)}
        </Text>
      </View>

      {readOnly ? (
        <Text style={styles.banner}>{t("business.team.roleManagement.readOnly")}</Text>
      ) : null}
      {soleActiveOwnerLocked ? (
        <Text style={styles.banner}>{t("business.team.roleManagement.lastOwnerCannotBeChanged")}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>{t("business.invites.role")}</Text>
      {ALL_ROLES.map((role) => {
        const ownerChoiceBlocked = role === "owner" && !isActorOwner;
        const disabled = !canEdit || ownerChoiceBlocked;
        const selected = selectedRole === role;
        return (
          <TouchableOpacity
            key={role}
            style={[styles.roleRow, selected && styles.roleRowSelected, disabled && styles.roleRowDisabled]}
            disabled={disabled}
            onPress={() => {
              if (!disabled) onSelectRole(role);
            }}
          >
            <View style={styles.roleRowHeader}>
              <Text style={[styles.roleTitle, disabled && styles.textDisabled]}>
                {t(`business.dashboard.teamLicenses.role.${role}`)}
              </Text>
              {ownerChoiceBlocked ? (
                <Text style={styles.hint} numberOfLines={2}>
                  {t("business.team.roleManagement.onlyOwnerCanAssignOwner")}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.roleDesc, disabled && styles.textDisabled]}>
              {t(`business.team.roleDescription.${role}`)}
            </Text>
          </TouchableOpacity>
        );
      })}

      {selectedRole ? (
        <View style={styles.permissionsBlock}>
          <Text style={styles.permissionsTitle}>
            {t("business.team.roleManagement.permissionsTitle")}
          </Text>
          {permissionsLocked ? (
            <Text style={styles.permissionsHint}>
              {t("business.team.roleManagement.ownerPermissionsLocked")}
            </Text>
          ) : showCustomHint ? (
            <Text style={styles.permissionsHint}>
              {t("business.team.roleManagement.customizedHint")}
            </Text>
          ) : null}

          {PERMISSION_SECTIONS.map((section) => (
            <View key={section.id} style={styles.permissionSection}>
              <Text style={styles.permissionSectionTitle}>
                {t(`business.permissions.section.${section.id}`)}
              </Text>
              {section.keys.map((key) => {
                const toggleDisabled = !canEdit || permissionsLocked;
                return (
                  <View key={key} style={styles.permissionRow}>
                    <View style={styles.permissionTextCol}>
                      <Text style={styles.permissionLabel}>
                        {t(`business.permissions.${key}.label`)}
                      </Text>
                      <Text style={styles.permissionDesc}>
                        {t(`business.permissions.${key}.description`)}
                      </Text>
                    </View>
                    <Switch
                      value={permissions[key]}
                      onValueChange={(value) => onTogglePermission(key, value)}
                      disabled={toggleDisabled}
                      trackColor={{ false: "#CBD5E1", true: colors.primary }}
                    />
                  </View>
                );
              })}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.secondaryButton, (!canEdit || permissionsLocked) && styles.buttonDisabled]}
            disabled={!canEdit || permissionsLocked}
            onPress={onResetDefaults}
          >
            <Text style={styles.secondaryButtonText}>
              {t("business.team.roleManagement.resetDefaults")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.saveButton, (!canEdit || saving || !isDirty) && styles.saveButtonDisabled]}
        disabled={!canEdit || saving || !isDirty}
        onPress={() => void onSave()}
      >
        <Text style={styles.saveButtonText}>
          {t("business.team.roleManagement.saveRoleAndPermissions")}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E1D3A",
  },
  muted: {
    color: "#94A3B8",
  },
  subtitle: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  name: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#3730A3",
    letterSpacing: 0.5,
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  currentRole: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  banner: {
    color: "#FDE68A",
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  roleRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  roleRowSelected: {
    borderColor: colors.primary,
  },
  roleRowDisabled: {
    opacity: 0.55,
  },
  roleRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  roleTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    flexShrink: 0,
  },
  hint: {
    flex: 1,
    textAlign: "right",
    fontSize: 10,
    color: "#64748B",
  },
  roleDesc: {
    marginTop: 6,
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  textDisabled: {
    color: "#94A3B8",
  },
  permissionsBlock: {
    gap: 10,
    marginTop: 4,
  },
  permissionsTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  permissionsHint: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18,
  },
  permissionSection: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  permissionSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 4,
  },
  permissionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  permissionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  permissionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  permissionDesc: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748B",
    lineHeight: 16,
  },
  secondaryButton: {
    backgroundColor: "#E2E8F0",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  saveButton: {
    marginTop: 8,
    backgroundColor: "#EA580C",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
});
