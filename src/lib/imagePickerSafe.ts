/**
 * Safe image picker wrapper – handles permissions, errors, and iOS-specific issues.
 * Use this instead of calling expo-image-picker directly to avoid crashes.
 */

export type PickImageResult = { uri: string; fileName?: string } | null;

async function getImagePicker() {
  try {
    return await import("expo-image-picker");
  } catch (e) {
    console.warn("[imagePickerSafe] Failed to load expo-image-picker:", e);
    return null;
  }
}

/**
 * Request media library permission. Returns true if granted.
 */
export async function requestMediaLibraryPermission(
  onDenied?: () => void
): Promise<boolean> {
  const ImagePicker = await getImagePicker();
  if (!ImagePicker) return false;
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      onDenied?.();
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[imagePickerSafe] requestMediaLibraryPermissions error:", e);
    onDenied?.();
    return false;
  }
}

/**
 * Request camera permission. Returns true if granted.
 */
export async function requestCameraPermission(onDenied?: () => void): Promise<boolean> {
  const ImagePicker = await getImagePicker();
  if (!ImagePicker) return false;
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      onDenied?.();
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[imagePickerSafe] requestCameraPermissions error:", e);
    onDenied?.();
    return false;
  }
}

/**
 * Pick image from gallery. Returns { uri, fileName } or null.
 * Handles permissions, errors, and defensive result checks.
 */
export async function pickImageFromGallery(options?: {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  onPermissionDenied?: () => void;
  onError?: (error: unknown) => void;
}): Promise<PickImageResult> {
  const ImagePicker = await getImagePicker();
  if (!ImagePicker) {
    options?.onError?.(new Error("Image picker not available"));
    return null;
  }
  try {
    const granted = await requestMediaLibraryPermission(options?.onPermissionDenied);
    if (!granted) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: options?.allowsEditing ?? true,
      aspect: options?.aspect ?? [1, 1],
      quality: options?.quality ?? 0.85,
    });

    if (!result || result.canceled) return null;
    const asset = result.assets?.[0];
    if (!asset?.uri) return null;
    return {
      uri: asset.uri,
      fileName: asset.fileName ?? undefined,
    };
  } catch (e) {
    console.warn("[imagePickerSafe] launchImageLibraryAsync error:", e);
    options?.onError?.(e);
    return null;
  }
}

/**
 * Take photo with camera. Returns { uri, fileName } or null.
 */
export async function takePhotoWithCamera(options?: {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  onPermissionDenied?: () => void;
  onError?: (error: unknown) => void;
}): Promise<PickImageResult> {
  const ImagePicker = await getImagePicker();
  if (!ImagePicker) {
    options?.onError?.(new Error("Image picker not available"));
    return null;
  }
  try {
    const granted = await requestCameraPermission(options?.onPermissionDenied);
    if (!granted) return null;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: options?.allowsEditing ?? true,
      aspect: options?.aspect ?? [1, 1],
      quality: options?.quality ?? 0.85,
    });

    if (!result || result.canceled) return null;
    const asset = result.assets?.[0];
    if (!asset?.uri) return null;
    return {
      uri: asset.uri,
      fileName: asset.fileName ?? undefined,
    };
  } catch (e) {
    console.warn("[imagePickerSafe] launchCameraAsync error:", e);
    options?.onError?.(e);
    return null;
  }
}
