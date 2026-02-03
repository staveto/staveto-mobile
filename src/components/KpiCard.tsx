/**
 * KPI Card Component
 * 
 * Reusable card component for displaying KPI metrics on the Home screen.
 * Cards are tappable and navigate to filtered views.
 */

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import type { KpiCard } from "../helpers/kpi/getKpiCards";

interface KpiCardProps {
  card: KpiCard;
  onPress: (card: KpiCard) => void;
}

export function KpiCardComponent({ card, onPress }: KpiCardProps) {
  const formatValue = (value: number, type: KpiCard["type"]): string => {
    if (type === "expenses_month" || type === "expenses_total") {
      // Format expenses with € symbol
      return `${value.toFixed(0)} €`;
    }
    // For counts, return as-is
    return value.toString();
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(card)}
      activeOpacity={0.7}
    >
      <Ionicons 
        name={card.icon as any} 
        size={20} 
        color={card.iconColor} 
      />
      <Text style={styles.value}>{formatValue(card.value, card.type)}</Text>
      <Text style={styles.label}>{card.label}</Text>
      {card.caption && (
        <Text style={styles.caption}>{card.caption}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "48%",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 100,
    justifyContent: "center",
  },
  value: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xs / 2,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
    fontWeight: "500",
  },
  caption: {
    fontSize: 9,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 2,
    fontStyle: "italic",
  },
});
