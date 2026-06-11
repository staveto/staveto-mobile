import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { getAuth } from "../../firebase";
import { ensureDirectChat } from "../../services/businessChat";
import {
  filterChatTeamMembers,
  listChatTeamMembers,
  type ChatTeamMember,
} from "../../services/businessChatTeam";

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function BusinessChatComposeScreen() {
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void; goBack: () => void };
  const { t } = useI18n();
  const { activeBusinessOrgId } = useActiveOrg();
  const uid = getAuth()?.currentUser?.uid ?? "";

  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<ChatTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingUid, setOpeningUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessOrgId || !uid) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    listChatTeamMembers(activeBusinessOrgId, uid)
      .then((rows) => {
        if (cancelled) return;
        setMembers(rows);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("business.chat.error"));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeBusinessOrgId, t, uid]);

  const filtered = useMemo(() => filterChatTeamMembers(members, query), [members, query]);

  const onSelectMember = async (member: ChatTeamMember) => {
    if (!activeBusinessOrgId || openingUid) return;
    setOpeningUid(member.uid);
    setError(null);
    try {
      const chat = await ensureDirectChat({
        orgId: activeBusinessOrgId,
        otherUid: member.uid,
        otherDisplayName: member.displayName,
      });
      nav.navigate("BusinessChatRoom", {
        orgId: activeBusinessOrgId,
        chatId: chat.id,
        title: member.displayName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("business.chat.error"));
    } finally {
      setOpeningUid(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => nav.goBack()} hitSlop={8}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title}>{t("business.chat.newMessageTitle")}</Text>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("business.chat.recipientPlaceholder")}
        placeholderTextColor="#94A3B8"
        style={styles.searchInput}
        autoFocus
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#EA580C" />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : filtered.length === 0 ? (
        <Text style={styles.emptyText}>{t("business.chat.noTeamMembers")}</Text>
      ) : (
        <>
          <Text style={styles.sectionLabel}>{t("business.chat.suggested")}</Text>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.uid}
            renderItem={({ item }) => {
              const busy = openingUid === item.uid;
              return (
                <Pressable
                  style={styles.memberRow}
                  onPress={() => void onSelectMember(item)}
                  disabled={!!openingUid}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{memberInitials(item.displayName)}</Text>
                  </View>
                  <View style={styles.memberCol}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                    <Text style={styles.memberRole} numberOfLines={1}>
                      {t(item.roleLabelKey)}
                    </Text>
                  </View>
                  {busy ? <ActivityIndicator size="small" color="#1E3A8A" /> : null}
                </Pressable>
              );
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  backText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    flex: 1,
  },
  searchInput: {
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0F172A",
    marginBottom: 12,
  },
  sectionLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1D376A",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  memberCol: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
  },
  memberRole: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "#CBD5E1",
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: "#FECACA",
    fontSize: 13,
    marginTop: 8,
  },
});
