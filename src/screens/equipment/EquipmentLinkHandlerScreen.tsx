import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../../theme";
import * as equipmentService from "../../services/equipment";

export function EquipmentLinkHandlerScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { qrToken } = (route.params as { qrToken?: string }) ?? {};
  const [status, setStatus] = useState<"loading" | "found" | "not_found" | "error">("loading");
  const [result, setResult] = useState<{ projectId: string; equipmentId: string } | null>(null);

  useEffect(() => {
    if (!qrToken) {
      setStatus("not_found");
      return;
    }
    equipmentService
      .findEquipmentByQrToken(qrToken)
      .then((r) => {
        if (r) {
          setResult(r);
          setStatus("found");
          (navigation as any).reset({
            index: 0,
            routes: [
              { name: "AppTabs" },
              {
                name: "EquipmentDetail",
                params: { projectId: r.projectId, equipmentId: r.equipmentId },
              },
            ],
          });
        } else {
          setStatus("not_found");
        }
      })
      .catch(() => setStatus("error"));
  }, [qrToken, navigation]);

  const goBack = () => navigation.goBack();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {status === "loading" && (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.message}>Načítavam zariadenie...</Text>
        </>
      )}
      {(status === "not_found" || status === "error") && (
        <>
          <Ionicons name="alert-circle-outline" size={64} color={colors.textMuted} />
          <Text style={styles.message}>
            {status === "not_found" ? "Zariadenie nebolo nájdené." : "Nastala chyba pri načítaní."}
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Text style={styles.backBtnText}>Späť</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  message: { marginTop: spacing.lg, fontSize: 16, color: colors.textOnDark, textAlign: "center" },
  backBtn: { marginTop: spacing.xl, padding: spacing.md },
  backBtnText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
});
