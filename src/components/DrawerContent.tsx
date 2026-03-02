import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  Switch,
  Alert,
  ActionSheetIOS,
  Platform,
  ActivityIndicator,
} from "react-native";
import { DrawerContentScrollView, DrawerContentComponentProps } from "@react-navigation/drawer";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";
import { db, getStorage } from "../firebase";
import * as ImagePicker from "expo-image-picker";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "../lib/rnFirestore";
import { getUserSubscription } from "../services/subscription";
import type { SubscriptionTier } from "../services/subscription";
import { SUPPORT_EMAIL } from "../constants/consent";
import { useUnreadCount } from "../hooks/useUnreadCount";
import auth from "@react-native-firebase/auth";
import { ICON_HIT_SLOP } from "../utils/accessibility";

type NavItem = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  labelKey: string;
  action: () => void;
};

function getPlanLabel(tier: SubscriptionTier | undefined): string {
  if (!tier || tier === "FREE") return "Free";
  if (tier === "PRO" || tier === "BASIC") return tier;
  return tier;
}

/** Minimum bottom inset for Android – edge-to-edge can report 0, causing Log out to overlap system nav bar. */
const ANDROID_MIN_BOTTOM_INSET = 48;

export function DrawerContent(props: DrawerContentComponentProps) {
  const { navigation } = props;
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === "android" ? Math.max(insets.bottom, ANDROID_MIN_BOTTOM_INSET) : insets.bottom;
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [planTier, setPlanTier] = useState<SubscriptionTier | undefined>(undefined);
  const [openToWork, setOpenToWork] = useState(false);
  const [updatingOpenToWork, setUpdatingOpenToWork] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const sendAgentDebugLog = useCallback(
    (hypothesisId: string, location: string, message: string, data: Record<string, unknown> = {}, runId = "profile-photo-upload") => {
      const payload = {
        runId,
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      };
      const endpointPrimary = "http://127.0.0.1:7242/ingest/0123687b-551a-46fb-a614-55cb13747844";
      const endpointAndroidEmulator = "http://10.0.2.2:7242/ingest/0123687b-551a-46fb-a614-55cb13747844";

      fetch(endpointPrimary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .catch(() =>
          fetch(endpointAndroidEmulator, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        )
        .catch(() => {});
    },
    []
  );

  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, "users", user.id)).then((snap: { exists: () => boolean; data: () => Record<string, unknown> }) => {
      if (snap.exists()) {
        const d = snap.data() as { photoURL?: string | null; openToWork?: boolean };
        setPhotoURL(d.photoURL ?? null);
        setOpenToWork(d.openToWork === true);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    getUserSubscription(user.id).then((sub) => {
      setPlanTier(sub?.tier);
    });
  }, [user?.id]);

  const closeDrawer = useCallback(() => {
    navigation.closeDrawer();
  }, [navigation]);

  const openSupportEmail = useCallback(async () => {
    const subject = encodeURIComponent("Staveto Support");
    const body = encodeURIComponent(`User: ${user?.email ?? "—"}\n\n`);
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  }, [user?.email]);

  const handleOpenToWorkChange = useCallback(
    async (value: boolean) => {
      if (!user?.id || updatingOpenToWork) return;
      setOpenToWork(value);
      setUpdatingOpenToWork(true);
      try {
        await updateDoc(doc(db, "users", user.id), {
          openToWork: value,
          updatedAt: serverTimestamp(),
        });
      } catch {
        setOpenToWork(!value);
      } finally {
        setUpdatingOpenToWork(false);
      }
    },
    [user?.id, updatingOpenToWork]
  );

  const pickProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      // #region agent log
      sendAgentDebugLog("H1", "DrawerContent.pickProfilePhoto.permission", "Media library permission result", {
        granted: status === "granted",
        status,
      });
      // #endregion agent log
      if (status !== "granted") {
        Alert.alert(t("account.permission"), t("account.galleryPermission"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      // #region agent log
      sendAgentDebugLog("H2", "DrawerContent.pickProfilePhoto.pickerResult", "Image picker result", {
        canceled: result.canceled,
        assetCount: result.assets?.length ?? 0,
        hasFirstAsset: Boolean(result.assets?.[0]),
        firstAssetUriScheme: result.assets?.[0]?.uri ? result.assets[0].uri.split(":")[0] : null,
        firstAssetFileName: result.assets?.[0]?.fileName ?? null,
      });
      // #endregion agent log
      if (result.canceled || !result.assets[0]) return;
      setUploadingPhoto(true);
      const asset = result.assets[0];
      const fileName = asset.fileName || `profile_${Date.now()}.jpg`;
      const storageInstance = getStorage();
      if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
      const storageRef = storageInstance.ref(`users/${user.id}/profile/${fileName}`);
      const userRef = doc(db, "users", user.id);
      const userSnap = await getDoc(userRef);
      // #region agent log
      sendAgentDebugLog("H3", "DrawerContent.pickProfilePhoto.uploadStart", "Starting Firebase Storage upload", {
        storagePath: `users/${user.id}/profile/${fileName}`,
        authUid: auth().currentUser?.uid ?? null,
        appUserId: user.id,
        userDocExistsBeforeWrite: userSnap.exists(),
        hasUri: Boolean(asset.uri),
        uriScheme: asset.uri ? asset.uri.split(":")[0] : null,
      });
      // #endregion agent log
      await storageRef.putFile(asset.uri);
      const url = await storageRef.getDownloadURL();
      // #region agent log
      sendAgentDebugLog("H4", "DrawerContent.pickProfilePhoto.uploadSuccess", "Storage upload and URL fetch succeeded", {
        hasDownloadUrl: Boolean(url),
        urlHost: url ? (() => { try { return new URL(url).host; } catch { return null; } })() : null,
      });
      // #endregion agent log
      await setDoc(userRef, { photoURL: url, updatedAt: serverTimestamp() }, { merge: true });
      // #region agent log
      sendAgentDebugLog("H5", "DrawerContent.pickProfilePhoto.firestoreUpdate", "User profile photoURL updated in Firestore", {
        authUid: auth().currentUser?.uid ?? null,
        userIdSuffix: user.id.slice(-6),
        updated: true,
      });
      // #endregion agent log
      setPhotoURL(url);
    } catch (error) {
      console.error("[drawer] Failed to pick profile photo:", error);
      // #region agent log
      sendAgentDebugLog("H6", "DrawerContent.pickProfilePhoto.catch", "Profile photo upload flow failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode:
          typeof error === "object" && error !== null && "code" in (error as Record<string, unknown>)
            ? String((error as Record<string, unknown>).code)
            : null,
      });
      // #endregion agent log
      Alert.alert(t("common.error"), t("account.uploadPhotoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.id, t, sendAgentDebugLog]);

  const takeProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("account.permission"), t("account.cameraPermission"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;
      setUploadingPhoto(true);
      const asset = result.assets[0];
      const fileName = asset.fileName || `profile_${Date.now()}.jpg`;
      const storageInstance = getStorage();
      if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
      const storageRef = storageInstance.ref(`users/${user.id}/profile/${fileName}`);
      await storageRef.putFile(asset.uri);
      const url = await storageRef.getDownloadURL();
      await setDoc(doc(db, "users", user.id), { photoURL: url, updatedAt: serverTimestamp() }, { merge: true });
      setPhotoURL(url);
    } catch (error) {
      console.error("[drawer] Failed to take profile photo:", error);
      Alert.alert(t("common.error"), t("account.takePhotoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.id, t]);

  const removeProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    setUploadingPhoto(true);
    try {
      await setDoc(doc(db, "users", user.id), { photoURL: null, updatedAt: serverTimestamp() }, { merge: true });
      setPhotoURL(null);
    } catch (error) {
      console.error("[drawer] Failed to remove profile photo:", error);
      Alert.alert(t("common.error"), t("account.uploadPhotoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.id, t]);

  const showProfilePhotoOptions = useCallback(() => {
    if (uploadingPhoto) return;
    const options = [t("cover.cancel"), t("cover.takePhoto"), t("cover.chooseFromGallery")];
    if (photoURL) options.push(t("cover.remove"));
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0 },
        async (buttonIndex) => {
          if (buttonIndex === 1) await takeProfilePhoto();
          else if (buttonIndex === 2) await pickProfilePhoto();
          else if (buttonIndex === 3 && photoURL) await removeProfilePhoto();
        }
      );
    } else {
      const buttons: { text: string; onPress?: () => void; style?: "cancel" }[] = [
        { text: t("cover.cancel"), style: "cancel" },
        { text: t("cover.takePhoto"), onPress: takeProfilePhoto },
        { text: t("cover.chooseFromGallery"), onPress: pickProfilePhoto },
      ];
      if (photoURL) buttons.push({ text: t("cover.remove"), onPress: removeProfilePhoto });
      Alert.alert(t("nav.profilePhotoTitle"), "", buttons);
    }
  }, [uploadingPhoto, photoURL, t, takeProfilePhoto, pickProfilePhoto, removeProfilePhoto]);

  const { count: unreadCount } = useUnreadCount();
  const displayName = user?.name ?? user?.firstName ?? user?.email ?? "—";
  const initials = displayName !== "—" ? displayName.slice(0, 2).toUpperCase() : "?";
  const isProTier = planTier === "PRO";

  const mainNavItems: NavItem[] = [
    { id: "projects", icon: "folder-open-outline", labelKey: "tabs.projects", action: () => { closeDrawer(); navigation.navigate("Main", { screen: "Projects" }); } },
    { id: "tasks", icon: "checkbox-outline", labelKey: "home.myTasks", action: () => { closeDrawer(); navigation.navigate("Main", { screen: "Home", params: { screen: "Tasks" } }); } },
    { id: "expenses", icon: "cash-outline", labelKey: "home.expenses", action: () => { closeDrawer(); navigation.navigate("Main", { screen: "Home", params: { screen: "ExpensesKpiScreen" } }); } },
    { id: "notifications", icon: "notifications-outline", labelKey: "tabs.notifications", action: () => { closeDrawer(); navigation.navigate("Main", { screen: "Notifications" }); } },
    { id: "messages", icon: "chatbubbles-outline", labelKey: "nav.messages", action: () => { closeDrawer(); /* TODO: Messages */ } },
  ];

  const bottomNavItems: NavItem[] = [
    { id: "settings", icon: "settings-outline", labelKey: "account.settings", action: () => { closeDrawer(); navigation.navigate("Main", { screen: "Account" }); } },
    { id: "support", icon: "help-circle-outline", labelKey: "home.support", action: () => { closeDrawer(); openSupportEmail(); } },
    { id: "knowhow", icon: "document-text-outline", labelKey: "nav.knowhow", action: () => { closeDrawer(); /* TODO: Knowhow */ } },
  ];

  const handleLogout = useCallback(() => {
    closeDrawer();
    logout();
  }, [closeDrawer, logout]);

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={[styles.container, styles.contentContainer, { paddingTop: insets.top + spacing.lg, paddingBottom: bottomInset + spacing.lg }]}
      scrollEnabled={true}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled={true}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.avatarWrap, openToWork && styles.avatarWrapOpenToWork]}
          onPress={showProfilePhotoOptions}
          activeOpacity={0.8}
          disabled={uploadingPhoto}
          accessibilityRole="button"
          accessibilityLabel={t("nav.profilePhotoTitle")}
          hitSlop={ICON_HIT_SLOP}
        >
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText} maxFontSizeMultiplier={1.2}>
                {initials}
              </Text>
            </View>
          )}
          {uploadingPhoto && (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.userName} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {displayName}
        </Text>
        <View style={[styles.planBadge, isProTier && styles.planBadgePro]}>
          <Text style={[styles.planText, isProTier && styles.planTextPro]} maxFontSizeMultiplier={1.1} numberOfLines={1}>
            {getPlanLabel(planTier)}
          </Text>
        </View>
        <View style={styles.openToWorkRow}>
          <Ionicons name="briefcase-outline" size={20} color={colors.textOnDark} style={styles.openToWorkIcon} />
          <Text style={styles.openToWorkLabel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("nav.openToWork")}
          </Text>
          <Switch
            value={openToWork}
            onValueChange={handleOpenToWorkChange}
            disabled={updatingOpenToWork}
            trackColor={{ false: "rgba(255,255,255,0.3)", true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={styles.navSection}>
        {mainNavItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.navRow}
            onPress={item.action}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t(item.labelKey)}
          >
            <View style={styles.navIconWrap}>
              <Ionicons name={item.icon} size={24} color={colors.textOnDark} style={styles.navIcon} />
              {item.id === "notifications" && unreadCount > 0 && (
                <View style={styles.navBadge}>
                  <Text style={styles.navBadgeText} maxFontSizeMultiplier={1.1} numberOfLines={1}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.navLabel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              {t(item.labelKey)}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.separator} />

      <View style={styles.bottomSection}>
        <TouchableOpacity
          style={styles.navRow}
          onPress={bottomNavItems[0].action}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t(bottomNavItems[0].labelKey)}
        >
          <View style={styles.navIconWrap}>
            <Ionicons name={bottomNavItems[0].icon} size={24} color={colors.textOnDark} style={styles.navIcon} />
          </View>
          <Text style={styles.navLabel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t(bottomNavItems[0].labelKey)}
          </Text>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={handleLogout}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("account.logout")}
          hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
        >
          <View style={styles.navIconWrap}>
            <Ionicons name="log-out-outline" size={24} color={colors.error} style={styles.navIcon} />
          </View>
          <Text style={[styles.navLabel, styles.logoutText]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("account.logout")}
          </Text>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        {bottomNavItems.slice(1).map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.navRow}
            onPress={item.action}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t(item.labelKey)}
          >
            <View style={styles.navIconWrap}>
              <Ionicons name={item.icon} size={24} color={colors.textOnDark} style={styles.navIcon} />
            </View>
            <Text style={styles.navLabel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              {t(item.labelKey)}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.spacer, { paddingBottom: bottomInset }]} />
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    marginBottom: spacing.sm,
    borderWidth: 3,
    borderColor: "transparent",
  },
  avatarWrapOpenToWork: {
    borderColor: colors.primary,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  userName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  planBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  planBadgePro: {
    backgroundColor: "rgba(255,215,0,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.6)",
  },
  planText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  planTextPro: {
    color: "#FFD700",
    fontWeight: "700",
  },
  openToWorkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    alignSelf: "stretch",
  },
  openToWorkIcon: {
    marginRight: spacing.sm,
    width: 24,
  },
  openToWorkLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textOnDark,
  },
  navSection: {
    paddingTop: spacing.md,
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  bottomSection: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  navIconWrap: {
    position: "relative",
    marginRight: spacing.md,
    width: 28,
  },
  navIcon: {
    width: 28,
  },
  navBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  navBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },
  navLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.textOnDark,
  },
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
  },
  logoutText: {
    color: colors.error,
    fontWeight: "600",
  },
});
