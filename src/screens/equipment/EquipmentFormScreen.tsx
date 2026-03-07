import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import * as equipmentService from "../../services/equipment";
import type { EquipmentCategory, EquipmentDoc } from "../../services/equipment";

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  console.warn("expo-image-picker not available for equipment photo");
}

const CATEGORIES: { value: EquipmentCategory; labelKey: string }[] = [
  { value: "machine", labelKey: "equipment.categoryMachine" },
  { value: "tool", labelKey: "equipment.categoryTool" },
  { value: "vehicle", labelKey: "equipment.categoryVehicle" },
  { value: "building", labelKey: "equipment.categoryBuilding" },
  { value: "other", labelKey: "equipment.categoryOther" },
];

const SUBCATEGORY_LABEL_KEYS: Record<string, string> = {
  bager: "equipment.subcategoryBager",
  nakladač: "equipment.subcategoryNakladac",
  miešačka: "equipment.subcategoryMiesacka",
  valec: "equipment.subcategoryValec",
  plošina: "equipment.subcategoryPlosina",
  generátor: "equipment.subcategoryGenerator",
  kompresor: "equipment.subcategoryKompresor",
  čerpadlo: "equipment.subcategoryCerpadlo",
  "vŕtačka": "equipment.subcategoryVrtacka",
  píla: "equipment.subcategoryPila",
  brúsky: "equipment.subcategoryBrushy",
  "vibračná doska": "equipment.subcategoryVibracnaDoska",
  laser: "equipment.subcategoryLaser",
  dodávka: "equipment.subcategoryDodavka",
  pickup: "equipment.subcategoryPickup",
  osobné: "equipment.subcategoryOsobne",
  príves: "equipment.subcategoryPrives",
  byt: "equipment.subcategoryByt",
  dom: "equipment.subcategoryDom",
  sklad: "equipment.subcategorySklad",
  areál: "equipment.subcategoryAreal",
  iné: "equipment.subcategoryIne",
};

const SUBCATEGORIES: Record<EquipmentCategory, { value: string }[]> = {
  machine: [
    { value: "bager" },
    { value: "nakladač" },
    { value: "miešačka" },
    { value: "valec" },
    { value: "plošina" },
    { value: "generátor" },
    { value: "kompresor" },
    { value: "čerpadlo" },
    { value: "iné" },
  ],
  tool: [
    { value: "vŕtačka" },
    { value: "píla" },
    { value: "brúsky" },
    { value: "vibračná doska" },
    { value: "laser" },
    { value: "iné" },
  ],
  vehicle: [
    { value: "dodávka" },
    { value: "pickup" },
    { value: "osobné" },
    { value: "príves" },
    { value: "iné" },
  ],
  building: [
    { value: "byt" },
    { value: "dom" },
    { value: "sklad" },
    { value: "areál" },
    { value: "iné" },
  ],
  other: [{ value: "iné" }],
};

const LABEL_PREFIX: Record<string, string> = {
  "machine.bager": "BAG",
  "machine.miešačka": "MIES",
  "machine.nakladač": "NAK",
  "machine.valec": "VAL",
  "machine.plošina": "PLO",
  "machine.generátor": "GEN",
  "machine.kompresor": "KOM",
  "machine.čerpadlo": "CER",
  "vehicle.dodávka": "VAN",
  "vehicle.pickup": "PIC",
  "vehicle.osobné": "OSO",
  "vehicle.príves": "PRI",
  "tool.vŕtačka": "VR",
  "tool.píla": "PIL",
  "tool.brúsky": "BRU",
  "building.sklad": "SKL",
};

function getLabelSuggest(category: EquipmentCategory, subcategory?: string): string {
  if (!subcategory || subcategory === "iné") return "EQ";
  const key = `${category}.${subcategory}`;
  return LABEL_PREFIX[key] ?? "EQ";
}

export function EquipmentFormScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { projectId, projectName, equipmentId, equipment: initialEquipment } = (route.params as {
    projectId?: string;
    projectName?: string;
    equipmentId?: string;
    equipment?: EquipmentDoc;
  }) ?? {};

  const isEdit = !!equipmentId;
  const [loading, setLoading] = useState(isEdit && !initialEquipment);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory>("other");
  const [subcategory, setSubcategory] = useState("");
  const [labelCode, setLabelCode] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isEdit || !projectId) return;
    const load = async () => {
      if (initialEquipment) {
        setName(initialEquipment.name);
        setCategory(initialEquipment.category);
        setSubcategory(initialEquipment.subcategory || "");
        setLabelCode(initialEquipment.labelCode || "");
        setModel(initialEquipment.model || "");
        setSerialNumber(initialEquipment.serialNumber || "");
        setLocation(initialEquipment.location || "");
        if (initialEquipment.photoUrl) setPhotoUri(initialEquipment.photoUrl);
        setLoading(false);
        return;
      }
      try {
        const eq = await equipmentService.getEquipment(projectId, equipmentId!);
        if (eq) {
          setName(eq.name);
          setCategory(eq.category);
          setSubcategory(eq.subcategory || "");
          setLabelCode(eq.labelCode || "");
          setModel(eq.model || "");
          setSerialNumber(eq.serialNumber || "");
          setLocation(eq.location || "");
          if (eq.photoUrl) setPhotoUri(eq.photoUrl);
        }
      } catch (e: any) {
        Alert.alert(t("common.error"), e.message || t("equipment.loadFailed"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isEdit, projectId, equipmentId, initialEquipment]);

  const goBack = () => navigation.goBack();

  const subcategoryOptions = SUBCATEGORIES[category];

  const onSuggestLabel = () => {
    if (labelCode.trim()) return;
    const prefix = getLabelSuggest(category, subcategory || undefined);
    setLabelCode(`${prefix}-01`);
  };

  const pickPhoto = async (source: "camera" | "gallery") => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("equipment.photoNotAvailable"));
      return;
    }
    try {
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(t("common.error"), t("equipment.cameraPermission"));
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          quality: 0.8,
        });
        const asset = result?.assets?.[0];
        if (!result?.canceled && asset?.uri) {
          setPhotoUri(asset.uri);
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(t("common.error"), t("equipment.galleryPermission"));
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: Platform.OS !== "ios",
          quality: 0.8,
        });
        const asset = result?.assets?.[0];
        if (!result?.canceled && asset?.uri) {
          setPhotoUri(asset.uri);
        }
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message || t("equipment.selectPhotoFailed"));
    }
  };

  const onSave = async () => {
    if (!projectId) return;
    if (!name.trim()) {
      Alert.alert(t("common.error"), t("equipment.nameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const finalLabelCode = labelCode.trim() || undefined;
      const patch = {
        name: name.trim(),
        category,
        subcategory: subcategory || undefined,
        labelCode: finalLabelCode,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        location: location.trim() || undefined,
      };

      if (isEdit && equipmentId) {
        const existingPhotoPath = initialEquipment?.photoPath;
        if (photoUri) {
          const isLocalUri = photoUri.startsWith("file://") || photoUri.startsWith("content://") || !photoUri.startsWith("http");
          if (isLocalUri) {
            if (existingPhotoPath) {
              await equipmentService.removeEquipmentPhoto(projectId, equipmentId, existingPhotoPath);
            }
            const mimeType = photoUri.includes(".png") ? "image/png" : "image/jpeg";
            const { photoUrl, photoPath } = await equipmentService.uploadEquipmentPhoto(
              projectId,
              equipmentId,
              photoUri,
              mimeType
            );
            await equipmentService.updateEquipment(projectId, equipmentId, { ...patch, photoUrl, photoPath });
          } else {
            await equipmentService.updateEquipment(projectId, equipmentId, patch);
          }
        } else {
          if (existingPhotoPath) {
            await equipmentService.removeEquipmentPhoto(projectId, equipmentId, existingPhotoPath);
            await equipmentService.updateEquipment(projectId, equipmentId, { ...patch, photoUrl: null, photoPath: null });
          } else {
            await equipmentService.updateEquipment(projectId, equipmentId, patch);
          }
        }
      } else {
        const id = await equipmentService.createEquipment(projectId, patch);
        if (photoUri) {
          const mimeType = photoUri.includes(".png") ? "image/png" : "image/jpeg";
          const { photoUrl, photoPath } = await equipmentService.uploadEquipmentPhoto(projectId, id, photoUri, mimeType);
          await equipmentService.updateEquipment(projectId, id, { photoUrl, photoPath });
        }
      }

      goBack();
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message || t("equipment.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const showPhotoOptions = () => {
    Alert.alert(t("equipment.addEquipmentPhoto"), "", [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("equipment.takePhoto"), onPress: () => pickPhoto("camera") },
      { text: t("equipment.selectFromGallery"), onPress: () => pickPhoto("gallery") },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? t("equipment.editEquipment") : t("equipment.addEquipmentTitle")}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.lg }]}>
        {/* Foto karta */}
        <TouchableOpacity style={styles.photoCard} onPress={showPhotoOptions} activeOpacity={0.8}>
          {photoUri ? (
            <View style={styles.photoPreview}>
              <Image source={{ uri: photoUri }} style={styles.photoImage} resizeMode="cover" />
              <View style={styles.photoOverlay}>
                <TouchableOpacity
                  style={styles.photoChangeBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    showPhotoOptions();
                  }}
                >
                  <Ionicons name="camera" size={20} color="#fff" />
                  <Text style={styles.photoChangeText}>{t("equipment.changePhoto")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    setPhotoUri(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                  <Text style={styles.photoChangeText}>{t("equipment.formRemove")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
              <Text style={styles.photoPlaceholderText}>{t("equipment.addEquipmentPhoto")}</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>{t("equipment.formName")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("equipment.formNamePlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>{t("equipment.formCategory")}</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.value}
              style={[styles.chip, category === c.value && styles.chipActive]}
              onPress={() => {
                setCategory(c.value);
                setSubcategory("");
              }}
            >
              <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>{t(c.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t("equipment.formSubcategory")}</Text>
        <View style={styles.subcategoryWrap}>
          {subcategoryOptions.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.subcategoryChip, subcategory === s.value && styles.chipActive]}
              onPress={() => setSubcategory(s.value)}
            >
              <Text style={[styles.chipText, subcategory === s.value && styles.chipTextActive]}>
                {t(SUBCATEGORY_LABEL_KEYS[s.value] ?? "equipment.subcategoryIne")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.labelCodeRow}>
          <Text style={styles.label}>{t("equipment.formLabelCode")}</Text>
          {!labelCode.trim() && (category !== "other" || subcategory) && (
            <TouchableOpacity onPress={onSuggestLabel} style={styles.suggestBtn}>
              <Text style={styles.suggestBtnText}>{t("equipment.formSuggest")}</Text>
            </TouchableOpacity>
          )}
        </View>
        <TextInput
          style={styles.input}
          placeholder={t("equipment.formLabelCodePlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={labelCode}
          onChangeText={setLabelCode}
        />

        <Text style={styles.label}>{t("equipment.model")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("equipment.formModelPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={model}
          onChangeText={setModel}
        />

        <Text style={styles.label}>{t("equipment.serialNumber")}</Text>
        <TextInput
          style={styles.input}
          placeholder=""
          placeholderTextColor={colors.textMuted}
          value={serialNumber}
          onChangeText={setSerialNumber}
        />

        <Text style={styles.label}>{t("equipment.location")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("equipment.formLocationPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={location}
          onChangeText={setLocation}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{t("common.save")}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { marginRight: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md },
  photoCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    minHeight: 140,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  photoPlaceholder: {
    flex: 1,
    minHeight: 140,
    justifyContent: "center",
    alignItems: "center",
  },
  photoPlaceholderText: { marginTop: spacing.sm, fontSize: 14, color: colors.textMuted },
  photoPreview: { width: "100%", height: 180 },
  photoImage: { width: "100%", height: "100%", borderRadius: radius },
  photoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.md,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  photoChangeBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  photoRemoveBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  photoChangeText: { color: "#fff", fontSize: 14 },
  label: { fontSize: 14, fontWeight: "600", color: colors.textOnDark, marginBottom: spacing.xs, marginTop: spacing.sm },
  labelCodeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  suggestBtn: { padding: spacing.xs },
  suggestBtnText: { fontSize: 13, color: colors.primary, fontWeight: "500" },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "20" },
  chipText: { fontSize: 14, color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: "600" },
  subcategoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  subcategoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    marginTop: spacing.xl,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
