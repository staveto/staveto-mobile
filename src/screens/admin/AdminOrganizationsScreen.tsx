import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { collection } from "../../lib/rnFirestore";
import { db } from "../../firebase";
import { getDocsSmart } from "../../services/firestoreSmartRead";
import { adminActivateBusinessOrg } from "../../services/adminBusiness";
import { colors } from "../../theme";

type OrganizationListItem = {
  id: string;
  name: string;
  status: string;
  businessEnabled: boolean;
  seatsLimit: number;
};

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "permission-denied" ||
    code === "firestore/permission-denied" ||
    message.includes("permission-denied")
  );
}

export function AdminOrganizationsScreen() {
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnlyMessage, setBackendOnlyMessage] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);
  const [seatInputs, setSeatInputs] = useState<Record<string, string>>({});
  const [activatingOrgId, setActivatingOrgId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBackendOnlyMessage(null);
    try {
      const snap = await getDocsSmart(collection(db, "organizations"));
      if (!mountedRef.current) return;
      const rows = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : d.id,
          status: typeof raw.status === "string" ? raw.status : "unknown",
          businessEnabled: raw.businessEnabled === true,
          seatsLimit:
            typeof raw.seatsLimit === "number" && Number.isFinite(raw.seatsLimit)
              ? raw.seatsLimit
              : 0,
        };
      });
      setOrganizations(rows);
      setSeatInputs((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const row of rows) {
          if (!next[row.id]) {
            next[row.id] = String(row.seatsLimit >= 1 ? row.seatsLimit : 15);
          }
        }
        return next;
      });
    } catch (e) {
      if (!mountedRef.current) return;
      if (isPermissionDenied(e)) {
        setBackendOnlyMessage("Zoznam firiem bude dostupný cez admin backend.");
      } else {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadOrganizations();
    return () => {
      mountedRef.current = false;
    };
  }, [loadOrganizations]);

  const onActivate = useCallback(
    async (org: OrganizationListItem) => {
      const raw = seatInputs[org.id] ?? "";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        Alert.alert("Neplatný seatsLimit", "Zadaj celé číslo aspoň 1.");
        return;
      }

      setActivatingOrgId(org.id);
      setActionMessage(null);
      try {
        const result = await adminActivateBusinessOrg({
          orgId: org.id,
          seatsLimit: parsed,
        });
        if (result.status === "already_active") {
          setActionMessage(
            result.message ?? "Organizácia už má aktívny Business. Seats limit meníme separátnou funkciou."
          );
        } else {
          setActionMessage(`Business bol aktivovaný pre ${org.name}.`);
        }
        await loadOrganizations();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        Alert.alert("Aktivácia zlyhala", message);
      } finally {
        setActivatingOrgId(null);
      }
    },
    [loadOrganizations, seatInputs]
  );

  const emptyMessage = useMemo(() => {
    if (backendOnlyMessage) return backendOnlyMessage;
    if (error) return `Nepodarilo sa načítať firmy: ${error}`;
    return "Zatiaľ nie sú dostupné žiadne firmy.";
  }, [backendOnlyMessage, error]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.helperText}>Načítavam firmy…</Text>
      </View>
    );
  }

  if (organizations.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Firmy</Text>
        <Text style={styles.helperText}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={organizations}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>ID: {item.id}</Text>
          <Text style={styles.meta}>Status: {item.status}</Text>
          <Text style={styles.meta}>
            Business enabled: {item.businessEnabled ? "áno" : "nie"}
          </Text>
          <Text style={styles.meta}>Seats limit: {item.seatsLimit}</Text>
          {!item.businessEnabled || item.status !== "active" ? (
            <View style={styles.activationRow}>
              <TextInput
                value={seatInputs[item.id] ?? ""}
                onChangeText={(value) =>
                  setSeatInputs((prev) => ({
                    ...prev,
                    [item.id]: value.replace(/[^0-9]/g, ""),
                  }))
                }
                keyboardType="number-pad"
                placeholder="Seats limit"
                placeholderTextColor={colors.textMuted}
                style={styles.seatInput}
              />
              <Pressable
                onPress={() => onActivate(item)}
                style={({ pressed }) => [
                  styles.activateButton,
                  pressed && styles.activateButtonPressed,
                  activatingOrgId === item.id && styles.activateButtonDisabled,
                ]}
                disabled={activatingOrgId === item.id}
              >
                <Text style={styles.activateButtonText}>
                  {activatingOrgId === item.id ? "Aktivujem…" : "Aktivovať Business"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.activeBadge}>Business je už aktívny.</Text>
          )}
        </View>
      )}
      ListHeaderComponent={
        actionMessage ? <Text style={styles.actionMessage}>{actionMessage}</Text> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  helperText: {
    marginTop: 10,
    fontSize: 14,
    textAlign: "center",
    color: colors.textMuted,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  activationRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  seatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.background,
  },
  activateButton: {
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.primary,
  },
  activateButtonPressed: {
    opacity: 0.9,
  },
  activateButtonDisabled: {
    opacity: 0.65,
  },
  activateButtonText: {
    color: colors.textOnDark,
    fontWeight: "600",
  },
  activeBadge: {
    marginTop: 10,
    color: colors.teamAccent,
    fontSize: 13,
    fontWeight: "600",
  },
  actionMessage: {
    marginBottom: 12,
    color: colors.text,
    fontSize: 13,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: colors.textMuted,
  },
});

