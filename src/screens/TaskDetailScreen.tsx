import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import * as tasksService from "../services/tasks";
import { colors, radius, spacing } from "../theme";

type Task = { id: string; projectId: string; title: string; status?: string; dueDate?: string };

const STATUSES: { value: string; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "DOING", label: "Robi sa" },
  { value: "DONE", label: "Hotové" },
  { value: "BLOCKED", label: "Blokované" },
  { value: "SKIPPED", label: "Preskočené" },
];

export function TaskDetailScreen() {
  const route = useRoute();
  const { orgId } = useAuth();
  const task = (route.params as { task: Task })?.task;
  const [status, setStatus] = useState((task?.status ?? "OPEN").toUpperCase());

  if (!task) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>Úloha nebola nájdená.</Text>
      </View>
    );
  }

  const onStatusChange = async (newStatus: string) => {
    if (!orgId || !task.projectId) return;
    setStatus(newStatus);
    try {
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, newStatus);
    } catch {
      setStatus((task.status ?? "OPEN").toUpperCase());
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{task.title || "Bez názvu"}</Text>
        {task.dueDate ? <Text style={styles.muted}>Termín: {task.dueDate}</Text> : null}
      </View>
      <Text style={styles.sectionLabel}>Status</Text>
      <View style={styles.statusRow}>
        {STATUSES.map((s) => (
          <TouchableOpacity
            key={s.value}
            style={[styles.statusBtn, status === s.value && styles.statusBtnActive]}
            onPress={() => onStatusChange(s.value)}
          >
            <Text style={[styles.statusBtnText, status === s.value && styles.statusBtnTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "600", color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  sectionLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  statusBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius, borderWidth: 1, borderColor: colors.border },
  statusBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusBtnText: { color: colors.text, fontSize: 14 },
  statusBtnTextActive: { color: "#fff" },
});
