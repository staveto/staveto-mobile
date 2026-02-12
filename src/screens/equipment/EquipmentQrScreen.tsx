import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../../theme";

let QRCode: React.ComponentType<{ value: string; size: number }> | null = null;
try {
  QRCode = require("react-native-qrcode-svg").default;
} catch (e) {
  console.warn("react-native-qrcode-svg not installed. QR display disabled.");
}

export function EquipmentQrScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { qrToken, name, labelCode } = (route.params as {
    qrToken?: string;
    name?: string;
    labelCode?: string;
  }) ?? {};

  const url = qrToken ? `staveto://equipment/${qrToken}` : "";
  const goBack = () => navigation.goBack();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QR kód</Text>
      </View>

      <View style={styles.content}>
        {QRCode && url ? (
          <View style={styles.qrWrap}>
            <QRCode value={url} size={200} />
          </View>
        ) : (
          <View style={styles.qrPlaceholder}>
            <Ionicons name="qr-code-outline" size={80} color={colors.textMuted} />
            <Text style={styles.placeholderText}>QR kód nie je k dispozícii</Text>
          </View>
        )}
        {name && <Text style={styles.nameText}>{name}</Text>}
        {labelCode && <Text style={styles.labelText}>{labelCode}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { marginRight: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  qrWrap: {
    padding: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius,
  },
  qrPlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: colors.card,
    borderRadius: radius,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: { marginTop: spacing.sm, fontSize: 14, color: colors.textMuted },
  nameText: { marginTop: spacing.lg, fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  labelText: { marginTop: spacing.xs, fontSize: 14, color: colors.textMuted },
});
