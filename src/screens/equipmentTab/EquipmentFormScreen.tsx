import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Modal,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import type { EquipmentCategory } from "../../services/equipment";
import * as userEquipmentService from "../../services/userEquipment";
import type { UserEquipmentStatus } from "../../services/userEquipment";
import type { EquipmentStackParamList } from "../../navigation/EquipmentStack";
import * as userServiceRules from "../../services/userServiceRules";
import * as userEquipmentServiceTasks from "../../services/userEquipmentServiceTasks";
import type { ServiceRuleDoc } from "../../services/serviceRules";

type R = RouteProp<EquipmentStackParamList, "EquipmentForm">;

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  /* optional */
}

let DateTimePicker: typeof import("@react-native-community/datetimepicker") | null = null;
try {
  DateTimePicker = require("@react-native-community/datetimepicker");
} catch {
  /* optional */
}

function genId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

function pickPrimaryActiveRule(rules: ServiceRuleDoc[]): ServiceRuleDoc | null {
  const active = rules.filter((r) => r.status === "active");
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0] ?? null;
}

async function ensureOpenTaskForRule(ownerUid: string, equipmentId: string, ruleId: string) {
  const tasks = await userEquipmentServiceTasks.listUserEquipmentServiceTasks(ownerUid, equipmentId, { status: "OPEN" });
  if (tasks.some((t) => t.serviceRuleId === ruleId)) return;
  const rule = await userServiceRules.getUserEquipmentServiceRule(ownerUid, equipmentId, ruleId);
  if (!rule) return;
  await userEquipmentServiceTasks.createUserEquipmentServiceTaskFromRule(
    ownerUid,
    equipmentId,
    rule,
    new Date(rule.nextDueAt)
  );
}

const CATEGORIES: { value: EquipmentCategory; labelKey: string }[] = [
  { value: "machine", labelKey: "equipment.categoryMachine" },
  { value: "tool", labelKey: "equipment.categoryTool" },
  { value: "vehicle", labelKey: "equipment.categoryVehicle" },
  { value: "building", labelKey: "equipment.categoryBuilding" },
  { value: "other", labelKey: "equipment.categoryOther" },
];

const STATUSES: UserEquipmentStatus[] = ["available", "assigned", "in_service", "inactive"];

export function EquipmentFormScreen() {
  const { t } = useI18n();
  const route = useRoute<R>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const equipmentId = route.params?.equipmentId;

  const isEdit = !!equipmentId;
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory>("other");
  const [kind, setKind] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [internalCode, setInternalCode] = useState("");
  const [locationText, setLocationText] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<UserEquipmentStatus>("available");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [existingPhotoPath, setExistingPhotoPath] = useState<string | null>(null);

  const [primaryRuleId, setPrimaryRuleId] = useState<string | null>(null);
  const [multipleActiveRules, setMultipleActiveRules] = useState(false);
  const [servicePlanTitle, setServicePlanTitle] = useState("");
  const [intervalUnit, setIntervalUnit] = useState<"weeks" | "months">("weeks");
  const [intervalValue, setIntervalValue] = useState("1");
  const [startFromDate, setStartFromDate] = useState(() => new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [checklistItems, setChecklistItems] = useState<{ id: string; title: string }[]>([]);

  const loadPrimaryRuleIntoForm = useCallback(
    (primary: ServiceRuleDoc | null, allActiveCount: number) => {
      setPrimaryRuleId(primary?.id ?? null);
      setMultipleActiveRules(allActiveCount > 1);
      if (primary) {
        setServicePlanTitle(primary.title);
        setIntervalUnit(primary.intervalUnit);
        setIntervalValue(String(primary.intervalValue));
        setStartFromDate(primary.startFrom ? new Date(primary.startFrom) : new Date());
        setChecklistItems((primary.checklistTemplate ?? []).map((i) => ({ id: i.id || genId(), title: i.title })));
      } else {
        setServicePlanTitle("");
        setIntervalUnit("weeks");
        setIntervalValue("1");
        setStartFromDate(new Date());
        setChecklistItems([]);
      }
    },
    []
  );

  useEffect(() => {
    if (!isEdit || !uid || !equipmentId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [doc, rules] = await Promise.all([
          userEquipmentService.getUserEquipment(uid, equipmentId),
          userServiceRules.listUserEquipmentServiceRules(uid, equipmentId, { status: "active" }),
        ]);
        if (doc) {
          setName(doc.name);
          setCategory((doc.category as EquipmentCategory) || "other");
          setKind(doc.kind ?? "");
          setModel(doc.model ?? "");
          setSerialNumber(doc.serialNumber ?? "");
          setInternalCode(doc.internalCode ?? "");
          setLocationText(doc.locationText ?? "");
          setNotes(doc.notes ?? "");
          setStatus(doc.status);
          if (doc.photoUrl) setPhotoUri(doc.photoUrl);
          setExistingPhotoPath(doc.photoPath ?? null);
        }
        const primary = pickPrimaryActiveRule(rules);
        loadPrimaryRuleIntoForm(primary, rules.length);
      } catch (e: unknown) {
        Alert.alert(t("common.error"), e instanceof Error ? e.message : t("equipmentTab.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, uid, equipmentId, t, loadPrimaryRuleIntoForm]);

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
        if (!result?.canceled && asset?.uri) setPhotoUri(asset.uri);
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
        if (!result?.canceled && asset?.uri) setPhotoUri(asset.uri);
      }
    } catch (e: unknown) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("equipment.selectPhotoFailed"));
    }
  };

  const showPhotoOptions = () => {
    Alert.alert(t("equipment.addEquipmentPhoto"), "", [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("equipment.takePhoto"), onPress: () => pickPhoto("camera") },
      { text: t("equipment.selectFromGallery"), onPress: () => pickPhoto("gallery") },
    ]);
  };

  const addChecklistItem = () => {
    setChecklistItems((prev) => [...prev, { id: genId(), title: "" }]);
  };

  const updateChecklistItem = (id: string, title: string) => {
    setChecklistItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i)));
  };

  const removeChecklistItem = (id: string) => {
    setChecklistItems((prev) => prev.filter((i) => i.id !== id));
  };

  const servicePlanIntent = () => {
    const titleTrim = servicePlanTitle.trim();
    const iv = parseInt(intervalValue, 10);
    if (titleTrim.length > 0) return true;
    if (!Number.isNaN(iv) && iv >= 1) return true;
    return checklistItems.some((i) => i.title.trim().length > 0);
  };

  const persistOptionalServicePlan = async (ownerUid: string, equipId: string) => {
    if (!servicePlanIntent()) return;

    const iv = parseInt(intervalValue, 10);
    if (Number.isNaN(iv) || iv < 1) {
      throw new Error(t("equipmentTab.formServiceIntervalInvalid"));
    }

    const resolvedTitle =
      servicePlanTitle.trim() ||
      name.trim() ||
      t("equipmentTab.formServiceDefaultPlanName");

    const checklist = checklistItems
      .filter((i) => i.title.trim())
      .map((i) => ({ id: i.id, title: i.title.trim() }));

    if (primaryRuleId) {
      await userServiceRules.updateUserEquipmentServiceRule(ownerUid, equipId, primaryRuleId, {
        title: resolvedTitle,
        intervalUnit,
        intervalValue: iv,
        startFrom: startFromDate,
        checklistTemplate: checklist,
      });
      await ensureOpenTaskForRule(ownerUid, equipId, primaryRuleId);
      return;
    }

    const rule = await userServiceRules.createUserEquipmentServiceRule(ownerUid, equipId, {
      title: resolvedTitle,
      intervalUnit,
      intervalValue: iv,
      startFrom: startFromDate,
      checklistTemplate: checklist,
    });
    const dueAt = new Date(rule.nextDueAt);
    await userEquipmentServiceTasks.createUserEquipmentServiceTaskFromRule(ownerUid, equipId, rule, dueAt);
  };

  const onSave = async () => {
    if (!uid) return;
    if (!name.trim()) {
      Alert.alert(t("common.error"), t("equipment.nameRequired"));
      return;
    }

    setSubmitting(true);
    let targetId = equipmentId ?? "";
    try {
      const base = {
        name: name.trim(),
        category,
        kind: kind.trim() || undefined,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        internalCode: internalCode.trim() || undefined,
        locationText: locationText.trim() || undefined,
        notes: notes.trim() || undefined,
        status,
      };

      if (isEdit && equipmentId) {
        targetId = equipmentId;
        if (photoUri && (photoUri.startsWith("file://") || photoUri.startsWith("content://") || !photoUri.startsWith("http"))) {
          if (existingPhotoPath) {
            await userEquipmentService.removeUserEquipmentPhoto(existingPhotoPath);
          }
          const mimeType = photoUri.includes(".png") ? "image/png" : "image/jpeg";
          const { photoUrl, photoPath } = await userEquipmentService.uploadUserEquipmentPhoto(uid, equipmentId, photoUri, mimeType);
          await userEquipmentService.updateUserEquipment(uid, equipmentId, { ...base, photoUrl, photoPath });
        } else if (!photoUri && existingPhotoPath) {
          await userEquipmentService.removeUserEquipmentPhoto(existingPhotoPath);
          await userEquipmentService.updateUserEquipment(uid, equipmentId, {
            ...base,
            photoUrl: null,
            photoPath: null,
          });
        } else {
          await userEquipmentService.updateUserEquipment(uid, equipmentId, base);
        }
      } else {
        targetId = await userEquipmentService.createUserEquipment(uid, base);
        if (photoUri) {
          const mimeType = photoUri.includes(".png") ? "image/png" : "image/jpeg";
          const { photoUrl, photoPath } = await userEquipmentService.uploadUserEquipmentPhoto(uid, targetId, photoUri, mimeType);
          await userEquipmentService.updateUserEquipment(uid, targetId, { photoUrl, photoPath });
        }
      }

      if (servicePlanIntent()) {
        try {
          await persistOptionalServicePlan(uid, targetId);
        } catch (planErr: unknown) {
          Alert.alert(
            t("common.error"),
            `${t("equipmentTab.formServiceSavePlanFailed")} ${planErr instanceof Error ? planErr.message : ""}`.trim()
          );
          setSubmitting(false);
          return;
        }
      }

      navigation.goBack();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("equipment.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!uid) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.mutedOnDark}>{t("equipmentTab.signInHint")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>{t("equipmentTab.formSectionEquipment")}</Text>

        <View style={styles.panel}>
          <Text style={styles.fieldLabel}>{t("equipment.formName")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={name}
            onChangeText={setName}
            placeholder={t("equipment.formNamePlaceholder")}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formCategoryType")}</Text>
          <View style={styles.chipsWrap}>
            {CATEGORIES.map((c) => {
              const active = category === c.value;
              return (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.chipDark, active && styles.chipDarkActive]}
                  onPress={() => setCategory(c.value)}
                >
                  <Text style={[styles.chipDarkText, active && styles.chipDarkTextActive]}>{t(c.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formKindOptional")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={kind}
            onChangeText={setKind}
            placeholder={t("equipmentTab.formKindPlaceholder")}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formModelOptional")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={model}
            onChangeText={setModel}
            placeholder={t("equipmentTab.formModelPlaceholder")}
            placeholderTextColor={colors.textMuted}
          />

          {isEdit ? (
            <>
              <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formStatus")}</Text>
              <View style={styles.chipsWrap}>
                {STATUSES.map((s) => {
                  const active = status === s;
                  const labelKey =
                    s === "available"
                      ? "equipmentTab.status.available"
                      : s === "assigned"
                        ? "equipmentTab.status.assigned"
                        : s === "in_service"
                          ? "equipmentTab.status.inService"
                          : "equipmentTab.status.inactive";
                  return (
                    <TouchableOpacity key={s} style={[styles.chipDark, active && styles.chipDarkActive]} onPress={() => setStatus(s)}>
                      <Text style={[styles.chipDarkText, active && styles.chipDarkTextActive]} numberOfLines={1}>
                        {t(labelKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipment.serialNumber")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={serialNumber}
            onChangeText={setSerialNumber}
            placeholder={t("equipmentTab.fieldSerial")}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.fieldInternalCode")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={internalCode}
            onChangeText={setInternalCode}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipment.location")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={locationText}
            onChangeText={setLocationText}
            placeholder={t("equipment.formLocationPlaceholder")}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.notes")}</Text>
          <TextInput
            style={[styles.inputOnPanel, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.photoSection")}</Text>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" /> : null}
          <TouchableOpacity style={styles.photoBtn} onPress={showPhotoOptions}>
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.photoBtnText}>{t("equipment.addEquipmentPhoto")}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitleDark}>{t("equipmentTab.formServiceSectionTitle")}</Text>
        <Text style={styles.sectionSubtitleDark}>{t("equipmentTab.formServiceTrackHint")}</Text>
        <Text style={styles.sectionBodyDark}>{t("equipmentTab.formServiceSectionSubtitle")}</Text>

        {multipleActiveRules ? (
          <View style={styles.infoBanner}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textOnDark} />
            <Text style={styles.infoBannerText}>{t("equipmentTab.formServicePrimaryRuleNote")}</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.fieldLabel}>{t("equipmentTab.formServicePlanName")}</Text>
          <TextInput
            style={styles.inputOnPanel}
            value={servicePlanTitle}
            onChangeText={setServicePlanTitle}
            placeholder={t("equipmentTab.formServicePlanPlaceholder")}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formServiceIntervalHint")}</Text>
          <View style={styles.intervalRow}>
            <Text style={styles.everyLabel}>{t("equipmentTab.formServiceIntervalEvery")}</Text>
            <TextInput
              style={[styles.inputOnPanel, styles.intervalInput]}
              placeholder="1"
              placeholderTextColor={colors.textMuted}
              value={intervalValue}
              onChangeText={setIntervalValue}
              keyboardType="number-pad"
            />
            <View style={styles.unitRow}>
              <TouchableOpacity
                style={[styles.unitChip, intervalUnit === "weeks" && styles.unitChipActive]}
                onPress={() => setIntervalUnit("weeks")}
              >
                <Text style={[styles.unitChipText, intervalUnit === "weeks" && styles.unitChipTextActive]}>{t("equipment.weeks")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitChip, intervalUnit === "months" && styles.unitChipActive]}
                onPress={() => setIntervalUnit("months")}
              >
                <Text style={[styles.unitChipText, intervalUnit === "months" && styles.unitChipTextActive]}>{t("equipment.months")}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formServiceStartDate")}</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowStartDatePicker(true)}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text style={styles.dateButtonText}>{format(startFromDate, "d.M.yyyy")}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpacing]}>{t("equipmentTab.formServiceChecklist")}</Text>
          {checklistItems.map((item) => (
            <View key={item.id} style={styles.checklistRow}>
              <TextInput
                style={[styles.inputOnPanel, styles.checklistInput]}
                placeholder={t("equipment.itemPlaceholder")}
                placeholderTextColor={colors.textMuted}
                value={item.title}
                onChangeText={(text) => updateChecklistItem(item.id, text)}
              />
              <TouchableOpacity onPress={() => removeChecklistItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addChecklist} onPress={addChecklistItem}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.addChecklistText}>{t("equipmentTab.formServiceAddChecklist")}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{t("equipmentTab.saveEquipment")}</Text>}
        </TouchableOpacity>
      </ScrollView>

      {showStartDatePicker && DateTimePicker ? (
        <>
          {Platform.OS === "ios" ? (
            <Modal visible={showStartDatePicker} transparent animationType="slide">
              <TouchableOpacity style={styles.datePickerOverlay} activeOpacity={1} onPress={() => setShowStartDatePicker(false)}>
                <View style={styles.datePickerModal}>
                  <Text style={styles.datePickerTitle}>{t("equipmentTab.formServiceStartDate")}</Text>
                  <View style={styles.datePickerContent}>
                    <DateTimePicker.default
                      value={startFromDate}
                      mode="date"
                      display="spinner"
                      onChange={(_event: unknown, selectedDate?: Date) => {
                        if (selectedDate) setStartFromDate(selectedDate);
                      }}
                    />
                  </View>
                  <View style={styles.datePickerButtons}>
                    <TouchableOpacity style={styles.datePickerCancel} onPress={() => setShowStartDatePicker(false)}>
                      <Text style={styles.datePickerCancelText}>{t("common.cancel")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.datePickerOk} onPress={() => setShowStartDatePicker(false)}>
                      <Text style={styles.datePickerOkText}>{t("common.ok")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            </Modal>
          ) : (
            <DateTimePicker.default
              value={startFromDate}
              mode="date"
              display="default"
              onChange={(_event: unknown, selectedDate?: Date) => {
                setShowStartDatePicker(false);
                if (selectedDate) setStartFromDate(selectedDate);
              }}
            />
          )}
        </>
      ) : null}
    </View>
  );
}

const R_FULL = 9999;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  mutedOnDark: { color: colors.labelMutedOnDark, fontSize: 15 },
  screenTitle: {
    color: colors.labelOnDark,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  sectionTitleDark: {
    color: colors.labelOnDark,
    fontSize: 17,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionSubtitleDark: {
    color: colors.labelMutedOnDark,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  sectionBodyDark: {
    color: colors.labelMutedOnDark,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.chipOnDarkBg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.chipOnDarkBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoBannerText: { flex: 1, color: colors.textOnDark, fontSize: 13, lineHeight: 18 },
  panel: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  fieldLabelSpacing: { marginTop: spacing.md },
  inputOnPanel: {
    backgroundColor: "#ffffff",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chipDark: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: R_FULL,
    borderWidth: 1,
    borderColor: colors.chipOnDarkBorder,
    backgroundColor: colors.chipOnDarkBg,
  },
  chipDarkActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(224, 103, 55, 0.28)",
  },
  chipDarkText: { color: colors.labelMutedOnDark, fontSize: 13, fontWeight: "500" },
  chipDarkTextActive: { color: colors.textOnDark, fontWeight: "700" },
  intervalRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  everyLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  intervalInput: { width: 72, textAlign: "center", paddingHorizontal: spacing.sm },
  unitRow: { flexDirection: "row", gap: spacing.sm, flexShrink: 1 },
  unitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  unitChipActive: { borderColor: colors.primary, backgroundColor: "rgba(224, 103, 55, 0.15)" },
  unitChipText: { fontSize: 14, color: colors.text },
  unitChipTextActive: { color: colors.primary, fontWeight: "700" },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#ffffff",
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateButtonText: { fontSize: 16, color: colors.text, fontWeight: "500", flex: 1 },
  checklistRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  checklistInput: { flex: 1 },
  addChecklist: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  addChecklistText: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  preview: { width: "100%", height: 180, borderRadius: radius, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: "rgba(224, 103, 55, 0.12)",
  },
  photoBtnText: { color: colors.primary, fontWeight: "700" },
  saveBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.12)",
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 17 },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  datePickerModal: {
    backgroundColor: colors.formPanel,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    padding: spacing.md,
  },
  datePickerTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  datePickerContent: { alignItems: "center" },
  datePickerButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.md },
  datePickerCancel: { padding: spacing.sm },
  datePickerCancelText: { fontSize: 16, color: colors.textMuted },
  datePickerOk: { padding: spacing.sm },
  datePickerOkText: { fontSize: 16, color: colors.primary, fontWeight: "600" },
});
