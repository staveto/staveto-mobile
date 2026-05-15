import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useI18n } from "../../i18n/I18nContext";
import { listMembers, type MembershipDoc } from "../../services/businessMembers";
import { approveBusinessMember } from "../../services/businessInvites";
import { colors } from "../../theme";

function getMemberName(member: MembershipDoc): string {
  const displayName = ((member as { displayName?: string }).displayName ?? "").trim();
  if (displayName) return displayName;
  const email = ((member as { email?: string; emailLower?: string }).email ?? member.emailLower ?? "").trim();
  if (email) return email;
  return member.userId || member.id;
}

export function BusinessTeamManagementScreen() {
  const { t } = useI18n();
  const { activeOrganization, activeMembership, refresh } = useActiveOrg();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MembershipDoc[]>([]);
  const [approveBusyFor, setApproveBusyFor] = useState<string | null>(null);
  const canApprove = activeMembership?.role === "owner" || activeMembership?.role === "admin";

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

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const activeRows = useMemo(
    () => rows.filter((row) => row.status.toLowerCase() === "active"),
    [rows]
  );
  const pendingRows = useMemo(
    () => rows.filter((row) => row.status.toLowerCase() === "pending"),
    [rows]
  );

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
      Alert.alert(t("business.invites.approve"), t("common.success"));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      Alert.alert(t("common.error"), details);
    } finally {
      setApproveBusyFor(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.dashboard.teamCardManage")}</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {t("business.dashboard.teamLicenses.members", { count: String(activeRows.length) })}
        </Text>
        {activeRows.length === 0 ? (
          <Text style={styles.empty}>{t("business.dashboard.teamLicenses.noMembers")}</Text>
        ) : (
          activeRows.map((member) => (
            <View key={member.id} style={styles.row}>
              <Text style={styles.name}>{getMemberName(member)}</Text>
              <Text style={styles.meta}>{t(`business.dashboard.teamLicenses.role.${member.role}`)}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {t("business.join.pendingTitle")} ({pendingRows.length})
        </Text>
        {pendingRows.length === 0 ? (
          <Text style={styles.empty}>{t("business.join.pendingBody")}</Text>
        ) : (
          pendingRows.map((member) => (
            <View key={member.id} style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{getMemberName(member)}</Text>
                <Text style={styles.meta}>{t(`business.dashboard.teamLicenses.role.${member.role}`)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.approveButton, (!canApprove || approveBusyFor === member.id) && styles.approveButtonDisabled]}
                disabled={!canApprove || approveBusyFor === member.id}
                onPress={() => void onApprove(member)}
              >
                <Text style={styles.approveButtonText}>
                  {t("business.invites.approve")}
                </Text>
              </TouchableOpacity>
            </View>
          ))
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
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  empty: {
    color: "#64748B",
    fontSize: 13,
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
  },
  pendingRow: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  name: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
  },
  meta: {
    marginTop: 2,
    color: "#64748B",
    fontSize: 12,
  },
  approveButton: {
    backgroundColor: "#EA580C",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  approveButtonDisabled: {
    opacity: 0.5,
  },
  approveButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});
