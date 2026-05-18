import { Platform } from "react-native";
import { spacing } from "../theme";

/**
 * Vertical padding for content directly under the default tab header from
 * `@react-navigation/bottom-tabs`. Safe area is already applied by the navigator —
 * do not add `insets.top` on top of that (it doubles the gap on Android/iOS).
 */
export function paddingBelowTabHeader(): number {
  return Platform.OS === "android" ? spacing.xs : spacing.sm;
}
