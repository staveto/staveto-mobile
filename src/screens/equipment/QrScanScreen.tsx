import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../../theme";
import * as equipmentService from "../../services/equipment";

let Camera: React.ComponentType<any> | null = null;
try {
  const expoCamera = require("expo-camera");
  Camera = expoCamera.CameraView;
} catch (e) {
  console.warn("expo-camera not installed. QR scan disabled.");
}

export function QrScanScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!Camera) return;
    (async () => {
      const { status } = await require("expo-camera").requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const match = data.match(/staveto:\/\/equipment\/([^/]+)/);
    const token = match ? match[1] : data;
    equipmentService
      .findEquipmentByQrToken(token)
      .then((r) => {
        if (r) {
          (navigation as any).navigate("EquipmentDetail", {
            projectId: r.projectId,
            equipmentId: r.equipmentId,
          });
        } else {
          Alert.alert("Nenájdené", "Zariadenie s týmto QR kódom nebolo nájdené.");
          setScanned(false);
        }
      })
      .catch(() => {
        Alert.alert("Chyba", "Nepodarilo sa načítať zariadenie.");
        setScanned(false);
      });
  };

  const goBack = () => navigation.goBack();

  if (!Camera) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.error}>Kamera nie je k dispozícii</Text>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnText}>Späť</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (hasPermission === null) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.message}>Žiadam o povolenie kamery...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.message}>Prístup ku kamere bol odopretý</Text>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnText}>Späť</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Skenovať QR</Text>
      </View>
      <View style={styles.cameraWrap}>
        <Camera
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
      </View>
      <Text style={styles.hint}>Naskenujte QR kód na zariadení</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  backBtn: { marginRight: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  cameraWrap: { flex: 1 },
  hint: {
    padding: spacing.lg,
    color: colors.textOnDark,
    textAlign: "center",
    backgroundColor: colors.background,
  },
  message: { fontSize: 16, color: colors.textOnDark },
  error: { fontSize: 16, color: colors.textMuted },
  backBtnText: { color: colors.primary, fontSize: 16, fontWeight: "600", marginTop: spacing.lg },
});
