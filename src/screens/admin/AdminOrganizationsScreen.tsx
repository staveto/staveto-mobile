import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { collection } from "../../lib/rnFirestore";
import { db } from "../../firebase";
import { getDocsSmart } from "../../services/firestoreSmartRead";
import { colors } from "../../theme";

type OrganizationListItem = {
  id: string;
  name: string;
  status: string;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnlyMessage, setBackendOnlyMessage] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setBackendOnlyMessage(null);
      try {
        const snap = await getDocsSmart(collection(db, "organizations"));
        if (cancelled) return;
        const rows = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : d.id,
            status: typeof raw.status === "string" ? raw.status : "unknown",
          };
        });
        setOrganizations(rows);
      } catch (e) {
        if (cancelled) return;
        if (isPermissionDenied(e)) {
          setBackendOnlyMessage("Zoznam firiem bude dostupný cez admin backend.");
        } else {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        </View>
      )}
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

