import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import { colors, radius, spacing } from "../theme";

type Project = { id: string; name: string };
type Task = { id: string; title: string; status?: string };

export function SearchScreen() {
  const { orgId } = useAuth();
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [pList, tList] = await Promise.all([
        projectsService.listMyProjects(orgId),
        tasksService.listMyTasks(orgId),
      ]);
      setProjects(pList);
      setTasks(tList.map((x) => ({ id: x.id, title: x.title, status: x.status })));
    } catch {
      setProjects([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const qLow = q.trim().toLowerCase();
  const filteredProjects = useMemo(
    () => (qLow ? projects.filter((p) => p.name.toLowerCase().includes(qLow)) : projects),
    [projects, qLow]
  );
  const filteredTasks = useMemo(
    () => (qLow ? tasks.filter((t) => (t.title ?? "").toLowerCase().includes(qLow)) : tasks),
    [tasks, qLow]
  );
  const hasResults = filteredProjects.length > 0 || filteredTasks.length > 0;
  const hasQuery = q.trim().length >= 1;

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={q}
        onChangeText={setQ}
        placeholder="Hľadať projekty a úlohy…"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
      />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : hasQuery && !hasResults ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Nič nenájdené</Text>
        </View>
      ) : (
        <FlatList
          data={[
            ...filteredProjects.map((p) => ({ type: "project" as const, id: p.id, name: p.name })),
            ...filteredTasks.map((t) => ({ type: "task" as const, id: t.id, name: t.title ?? "—" })),
          ]}
          keyExtractor={(x) => `${x.type}-${x.id}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.badge}>{item.type === "project" ? "P" : "Ú"}</Text>
              <Text style={styles.name}>{item.name}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    margin: spacing.md,
  },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  muted: { fontSize: 14, color: colors.textMuted },
  list: { padding: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    color: "#fff",
    textAlign: "center",
    lineHeight: 28,
    fontSize: 12,
    fontWeight: "700",
    marginRight: spacing.md,
  },
  name: { fontSize: 16, color: colors.text, flex: 1 },
});
