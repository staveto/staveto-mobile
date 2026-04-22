import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import type { ActiveProjectStorageType } from "../lib/projectTypeModel";

export type SelectableProjectType = ActiveProjectStorageType;

type ProjectTypeCrossroadProps = {
  selectedType: SelectableProjectType | null;
  onSelectType: (type: SelectableProjectType) => void;
};

const OPTIONS: { type: ActiveProjectStorageType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: "BUILD", icon: "clipboard-outline" },
  { type: "TRADE", icon: "briefcase-outline" },
];

/**
 * Legacy crossroad UI — product now supports **BUILD** and **TRADE** only.
 */
export function ProjectTypeCrossroad({ selectedType, onSelectType }: ProjectTypeCrossroadProps) {
  return (
    <View style={styles.row}>
      {OPTIONS.map(({ type, icon }) => {
        const active = selectedType === type;
        return (
          <TouchableOpacity
            key={type}
            style={[styles.card, active && styles.cardActive]}
            onPress={() => onSelectType(type)}
            activeOpacity={0.85}
          >
            <Ionicons name={icon} size={28} color={active ? colors.primary : colors.textMuted} />
            <Text style={[styles.label, active && styles.labelActive]}>{type}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, justifyContent: "center" },
  card: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.sm,
  },
  cardActive: { borderColor: colors.primary, backgroundColor: "rgba(224, 103, 55, 0.12)" },
  label: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  labelActive: { color: colors.primary },
});
