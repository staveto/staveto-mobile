import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useI18n } from "../../i18n/I18nContext";
import { getAuth } from "../../firebase";
import {
  getMembershipDisplayMeta,
  listMembers,
  type MembershipDoc,
} from "../../services/businessMembers";
import type { OrgRole } from "../../services/organizations";
import { approveBusinessMember } from "../../services/businessInvites";
import { colors } from "../../theme";

const ROLE_SORT: Record<OrgRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  worker: 3,
  viewer: 4,
};

function memberStatusI18nKey(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return "business.team.status.active";
  if (s === "pending") return "business.team.status.pending";
  if (s === "invited") return "business.team.status.invited";
  if (s === "suspended") return "business.team.status.suspended";
  if (s === "removed") return "business.team.status.removed";
  return "business.team.status.pending";
}

export function BusinessTeamManagementScreen() {
  const { t } = useI18n();
  const navigation = useNavigation() as unknown as {
    navigate: (name: string, params?: { orgId: string; memberDocId: string }) => void;
  };
  const { activeOrganization, activeMembership, refresh } = useActiveOrg();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MembershipDoc[]>([]);
  const [approveBusyFor, setApproveBusyFor] = useState<string | null>(null);
  const canApprove = activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const canManageRoles = activeMembership?.role === "owner" || activeMembership?.role === "admin";

  const authUser = getAuth()?.currentUser ?? null;
  const displayOptions = useMemo(
    () => ({
      currentUserUid: authUser?.uid ?? null,
      currentUserDisplayName: authUser?.displayName ?? null,
      currentUserEmail: authUser?.email ?? null,
    }),
    [authUser?.uid, authUser?.displayName, authUser?.email]
  );

  const loadMembers = useCallback(async () => {
    const orgId = activeOrganization?.id;
    if (!orgId) return;
    setLoading(true);
    try {
      const members = await listMembers(orgId);
      setRows(members);
    } catch (error) {
      console.warn("[BusinessTeamManagement] loadMembers failed", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeOrganization?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadMembers();
    }, [loadMembers])
  );

  const activeRows = useMemo(
    () => rows.filter((row) => row.status.toLowerCase() === "active"),
    [rows]
  );
  const pendingRows = useMemo(
    () =>
      rows.filter((row) => {
        const s = row.status.toLowerCase();
        return s === "pending" || s === "invited";
      }),
    [rows]
  );

  const activeSorted = useMemo(() => {
    return [...activeRows].sort((a, b) => {
      const ra = ROLE_SORT[a.role] ?? 99;
      const rb = ROLE_SORT[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      const pa = getMembershipDisplayMeta(a, t, displayOptions).primary.toLowerCase();
      const pb = getMembershipDisplayMeta(b, t, displayOptions).primary.toLowerCase();
      return pa.localeCompare(pb);
    });
  }, [activeRows, t, displayOptions]);

  const totalTeamMembers = useMemo(
    () => rows.filter((r) => r.status.toLowerCase() !== "removed").length,
    [rows]
  );

  const seatsLimit = activeOrganization?.seatsLimit ?? 0;
  const seatsUsed = activeOrganization?.seatsUsed ?? activeRows.length;
  const freeSeats = Math.max(0, seatsLimit - seatsUsed);

  const onApprove = async (member: MembershipDoc) => {
    const orgId = activeOrganization?.id;
    if (!orgId || !member.userId) {
      Alert.alert(t("common.error"), t("business.invites.approveComingSoon"));
      return;
    }
    setApproveBusyFor(member.id);
    try {
      await approveBusinessMember({ orgId, userId: member.userId });
      await Promise.all([loadMembers(), refresh()]);
      Alert.alert("", t("business.team.memberApproved"));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      Alert.alert(t("common.error"), details);
    } finally {
      setApproveBusyFor(null);
    }
  };

  const openMemberRole = (member: MembershipDoc) => {
    const orgId = activeOrganization?.id;
    if (!orgId || !canManageRoles) return;
    navigation.navigate("BusinessMemberRole", { orgId, memberDocId: member.id });
  };

  const renderMemberRow = (member: MembershipDoc, opts: { pending?: boolean }) => {
    const meta = getMembershipDisplayMeta(member, t, displayOptions);
    const roleLabel = t(`business.dashboard.teamLicenses.role.${member.role}`);
    const statusLabel = t(memberStatusI18nKey(member.status));
    const metaLine = `${roleLabel} · ${statusLabel}`;

    const body = (
      <View style={styles.rowInner}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText} maxFontSizeMultiplier={1.3}>
            {meta.initials}
          </Text>
        </View>
        <View style={styles.rowTextCol}>
          <Text style={styles.primaryName} numberOfLines={1}>
            {meta.primary}
          </Text>
          {meta.secondary ? (
            <Text style={styles.secondaryEmail} numberOfLines={1}>
              {meta.secondary}
            </Text>
          ) : null}
          <Text style={styles.metaLine} numberOfLines={1}>
            {metaLine}
          </Text>
          {meta.showInternalId ? (
            <Text style={styles.internalId} numberOfLines={1}>
              {t("business.team.internalId")}: {meta.internalId}
            </Text>
          ) : null}
        </View>
      </View>
    );

    if (canManageRoles && !opts.pending) {
      return (
        <TouchableOpacity
          key={member.id}
          style={styles.memberRow}
          onPress={() => openMemberRole(member)}
          accessibilityRole="button"
        >
          {body}
        </TouchableOpacity>
      );
    }
    if (canManageRoles && opts.pending) {
      return (
        <View key={member.id} style={styles.memberRow}>
          <TouchableOpacity style={styles.pendingMainTap} onPress={() => openMemberRole(member)}>
            {body}
          </TouchableOpacity>
          {canApprove ? (
            <TouchableOpacity
              style={[
                styles.approveButton,
                styles.approveButtonBlock,
                approveBusyFor === member.id && styles.approveButtonDisabled,
              ]}
              disabled={approveBusyFor === member.id}
              onPress={() => void onApprove(member)}
            >
              <Text style={styles.approveButtonText}>{t("business.invites.approve")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    return (
      <View key={member.id} style={styles.memberRow}>
        {body}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>{t("business.dashboard.teamCardManage")}</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{t("business.team.summary.title")}</Text>
        <Text style={styles.summaryLine}>
          {t("business.team.summary.membersCount", { count: String(totalTeamMembers) })}
        </Text>
        <Text style={styles.summaryLine}>
          {t("business.team.summary.activePending", {
            active: String(activeRows.length),
            pending: String(pendingRows.length),
          })}
        </Text>
        <Text style={styles.summaryLineMuted}>
          {t("business.team.summary.licenses", {
            used: String(seatsUsed),
            limit: String(seatsLimit || "—"),
            free: String(freeSeats),
          })}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("business.team.activeMembers")}</Text>
        {activeSorted.length === 0 ? (
          <Text style={styles.empty}>{t("business.dashboard.teamLicenses.noMembers")}</Text>
        ) : (
          activeSorted.map((member) => renderMemberRow(member, { pending: false }))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("business.team.pendingRequests")}</Text>
        {pendingRows.length === 0 ? (
          <Text style={styles.empty}>{t("business.team.noPendingRequests")}</Text>
        ) : (
          pendingRows.map((member) => renderMemberRow(member, { pending: true }))
        )}
      </View>
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
    gap: 14,
    paddingBottom: 28,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 2,
  },
  summaryCard: {
    backgroundColor: "#132347",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    gap: 6,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  summaryLine: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E2E8F0",
  },
  summaryLineMuted: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94A3B8",
    marginTop: 2,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 4,
    gap: 0,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  empty: {
    color: "#64748B",
    fontSize: 13,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  memberRow: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pendingMainTap: {
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  primaryName: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryEmail: {
    marginTop: 2,
    color: "#475569",
    fontSize: 13,
    fontWeight: "500",
  },
  metaLine: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  internalId: {
    marginTop: 2,
    color: "#94A3B8",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  approveButton: {
    backgroundColor: "#EA580C",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "center",
  },
  approveButtonBlock: {
    alignSelf: "stretch",
    marginTop: 10,
    alignItems: "center",
  },
  approveButtonDisabled: {
    opacity: 0.5,
  },
  approveButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
