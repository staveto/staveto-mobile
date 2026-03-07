/**
 * ProjectShareCard – shareable image layout for Instagram Story (1080×1920)
 * Rendered offscreen and captured via react-native-view-shot.
 */
import React, { forwardRef } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { colors, spacing } from "../theme";

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

export interface ProjectShareCardProps {
  projectName: string;
  address: string;
  statusLabel: string;
  progressPct: number;
  tasksDone: number;
  tasksTotal: number;
  tasksOverdue: number;
  openProblems: number;
  expensesTotal: number;
  lastPhotos: string[];
}

export const ProjectShareCard = forwardRef<View, ProjectShareCardProps>(
  (
    {
      projectName,
      address,
      statusLabel,
      progressPct,
      tasksDone,
      tasksTotal,
      tasksOverdue,
      openProblems,
      expensesTotal,
      lastPhotos,
    },
    ref
  ) => {
    return (
      <View ref={ref} style={styles.container} collapsable={false}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>Staveto</Text>
          <Text style={styles.projectName} numberOfLines={1}>
            {projectName}
          </Text>
        </View>

        <View style={styles.ringContainer}>
          <View style={styles.ringOuter}>
            <View style={styles.ringInner}>
              <Text style={styles.ringPct}>{progressPct}%</Text>
              <Text style={styles.ringLabel}>dokončené</Text>
            </View>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <Text style={styles.kpiText}>✅ {tasksDone} hotovo</Text>
          <Text style={styles.kpiText}>⏳ {tasksTotal - tasksDone} otvorené</Text>
          <Text style={styles.kpiText}>🔴 {openProblems} problém</Text>
          <Text style={styles.kpiText}>💶 {expensesTotal.toLocaleString("sk-SK")} €</Text>
        </View>

        {lastPhotos.length > 0 && (
          <View style={styles.photoStrip}>
            {lastPhotos.slice(0, 3).map((uri, i) => (
              <Image
                key={i}
                source={{ uri }}
                style={styles.photoThumb}
                resizeMode="cover"
              />
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Built with Staveto</Text>
        </View>
      </View>
    );
  }
);

ProjectShareCard.displayName = "ProjectShareCard";

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  topBar: {
    marginBottom: spacing.lg,
  },
  logo: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textOnDark,
    opacity: 0.9,
  },
  projectName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
    marginTop: spacing.xs,
  },
  ringContainer: {
    alignItems: "center",
    marginVertical: spacing.xl,
  },
  ringOuter: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 12,
    borderColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  ringInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  ringPct: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.primary,
  },
  ringLabel: {
    fontSize: 12,
    color: colors.textOnDark,
    marginTop: 2,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  kpiText: {
    fontSize: 14,
    color: colors.textOnDark,
    fontWeight: "500",
  },
  photoStrip: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    flex: 1,
  },
  photoThumb: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
  },
  footer: {
    position: "absolute",
    bottom: spacing.lg,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
    color: colors.textOnDark,
    opacity: 0.7,
  },
});
