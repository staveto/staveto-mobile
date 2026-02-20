/**
 * Project cover photo service.
 * Storage path: projects/{projectId}/cover/{timestamp}.jpg
 * Firestore fields: coverImageUrl, coverImageUpdatedAt, coverImagePath
 */
import { storage, auth, db } from "../firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "../lib/rnFirestore";

const COLLECTION = "projects";

export type PickResult = { uri: string } | null;

/**
 * Pick cover image (convenience wrapper). For i18n, use pickCoverImageWithOptions(t).
 */
export async function pickCoverImage(): Promise<PickResult> {
  return pickCoverImageWithOptions((k) => k);
}

/**
 * Pick cover image with translated options. Caller provides t() for i18n.
 * If action is 'camera' or 'gallery', skips the picker sheet and goes straight to that source.
 */
export async function pickCoverImageWithOptions(
  t: (key: string) => string,
  action?: "camera" | "gallery"
): Promise<PickResult> {
  try {
    const ImagePickerModule = await import("expo-image-picker");
    const ImagePicker = (ImagePickerModule as any).default ?? ImagePickerModule;
    const { launchImageLibraryAsync, launchCameraAsync } = ImagePickerModule;
    const { requestCameraPermissionsAsync, requestMediaLibraryPermissionsAsync } = ImagePickerModule;
    const { Alert, ActionSheetIOS, Platform } = await import("react-native");

    const mediaTypes = ImagePicker?.MediaTypeOptions?.Images ?? "images";

    const handleTakePhoto = async (): Promise<PickResult> => {
      const { status } = await requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("cover.permissionTitle") || "Permission", t("cover.cameraPermission") || "Camera access is required.");
        return null;
      }
      const result = await launchCameraAsync({
        mediaTypes,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) {
        return { uri: result.assets[0].uri };
      }
      return null;
    };

    const handleChooseGallery = async (): Promise<PickResult> => {
      const { status } = await requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("cover.permissionTitle") || "Permission", t("cover.galleryPermission") || "Gallery access is required.");
        return null;
      }
      const result = await launchImageLibraryAsync({
        mediaTypes,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) {
        return { uri: result.assets[0].uri };
      }
      return null;
    };

    if (action === "camera") return handleTakePhoto();
    if (action === "gallery") return handleChooseGallery();

    return new Promise<PickResult>((resolve) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [t("cover.cancel"), t("cover.takePhoto"), t("cover.chooseFromGallery")],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) resolve(await handleTakePhoto());
            else if (buttonIndex === 2) resolve(await handleChooseGallery());
            else resolve(null);
          }
        );
      } else {
        Alert.alert(
          t("cover.changeTitle"),
          "",
          [
            { text: t("cover.cancel"), style: "cancel", onPress: () => resolve(null) },
            { text: t("cover.takePhoto"), onPress: async () => resolve(await handleTakePhoto()) },
            { text: t("cover.chooseFromGallery"), onPress: async () => resolve(await handleChooseGallery()) },
          ]
        );
      }
    });
  } catch (e) {
    console.warn("[projectCover] pickCoverImageWithOptions error:", e);
    return null;
  }
}

/**
 * Upload cover image to Firebase Storage and return download URL + path.
 * Path: projects/{projectId}/cover/{timestamp}.jpg
 */
export async function uploadProjectCover(
  projectId: string,
  localUri: string
): Promise<{ url: string; path: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("You must be signed in to upload a cover photo.");
  }

  const projectRef = doc(db, COLLECTION, projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    throw new Error("Project not found.");
  }
  const projectData = projectSnap.data();
  if (projectData?.ownerId !== currentUser.uid) {
    throw new Error("You do not have permission to update this project's cover.");
  }

  const timestamp = Date.now();
  const storagePath = `projects/${projectId}/cover/${timestamp}.jpg`;
  const storageRef = storage.ref(storagePath);

  try {
    await storageRef.putFile(localUri, { contentType: "image/jpeg" });
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    console.error("[projectCover] Upload failed:", err);
    throw new Error(err.message || "Upload failed.");
  }

  const url = await storageRef.getDownloadURL();
  return { url, path: storagePath };
}

/**
 * Update Firestore project doc with cover URL and path.
 * Optionally delete old file at oldPath (best-effort).
 */
export async function setProjectCover(
  projectId: string,
  params: { url: string; path: string },
  oldPath?: string | null
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("You must be signed in to update the cover.");
  }

  if (oldPath?.trim()) {
    try {
      const oldRef = storage.ref(oldPath);
      await oldRef.delete();
      console.log("[projectCover] Deleted old cover:", oldPath);
    } catch (e) {
      console.warn("[projectCover] Failed to delete old cover (non-fatal):", e);
    }
  }

  const ref = doc(db, COLLECTION, projectId);
  await updateDoc(ref, {
    coverImageUrl: params.url,
    coverImagePath: params.path,
    coverImageUpdatedAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
  console.log("[projectCover] Set cover for project", projectId);
}

/**
 * Remove project cover: clear Firestore fields and delete Storage file.
 */
export async function removeProjectCover(projectId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("You must be signed in to remove the cover.");
  }

  const projectRef = doc(db, COLLECTION, projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    throw new Error("Project not found.");
  }
  const data = projectSnap.data();
  if (data?.ownerId !== currentUser.uid) {
    throw new Error("You do not have permission to update this project.");
  }

  const oldPath = (data?.coverImagePath as string) || undefined;
  if (oldPath?.trim()) {
    try {
      const storageRef = storage.ref(oldPath);
      await storageRef.delete();
      console.log("[projectCover] Deleted cover file:", oldPath);
    } catch (e) {
      console.warn("[projectCover] Failed to delete cover file (non-fatal):", e);
    }
  }

  await updateDoc(projectRef, {
    coverImageUrl: null,
    coverImagePath: null,
    coverImageUpdatedAt: null,
    updatedAt: serverTimestamp(),
  });
  console.log("[projectCover] Removed cover for project", projectId);
}
